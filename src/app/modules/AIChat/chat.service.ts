import {
  sendStreamChunkToUser,
  sendStreamEndToUser,
  sendStreamStartToUser,
  sendDoctorRecommendationToUser,
} from "../../../helpars/socket/socketHelper";
import prisma from "../../../shared/prisma";
import openai from "../../../shared/openai";
import { getConnectedUsers } from "../../../helpars/socket/socketHandler";

const today = new Date();

// Get the start of today (00:00:00)
const startOfToday = new Date(
  today.getFullYear(),
  today.getMonth(),
  today.getDate(),
);

// Get the start of tomorrow (00:00:00)
const startOfTomorrow = new Date(
  today.getFullYear(),
  today.getMonth(),
  today.getDate() + 1,
);

const createChat = async (userId: string, question: string) => {
  const todayChat = await prisma.chat.count({
    where: {
      userId: userId,
      createdAt: {
        gte: startOfToday,
        lt: startOfTomorrow,
      },
    },
  });

  const chatLimit = await prisma.allowAiChat.findFirst();

  console.log(
    "🚀 ~ file: chat.service.ts:48 ~ createChat ~ todayChat:",
    todayChat,
  );

  console.log("Today Chat", todayChat);
  console.log("Chat limit", chatLimit);

  if (chatLimit) {
    if (todayChat >= chatLimit.limit) {
      // throw new Error("You have reached the limit of 3 chats per day.");

      const senderPresence = getConnectedUsers().get(userId);

      if (senderPresence && senderPresence.ws) {
        senderPresence.ws.send(
          JSON.stringify({
            type: "limitExceeded",
            message: `You have reached the limit of ${chatLimit.limit} chats per day.`,
            createdAt: new Date().toISOString(),
          }),
        );
      }
      
      return "You have reached the limit chats";
    }
  }

  try {
    // 0️⃣ Send stream start signal
    sendStreamStartToUser(userId, question);

    // 1️⃣ Call OpenAI with streaming enabled and tools
    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a helpful medical assistant. If the user asks for a doctor or if you recommend seeing a specialist, calls the 'recommend_doctor' function with the appropriate specialty. Otherwise, just answer the question helpfuly.",
        },
        {
          role: "user",
          content: question,
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "recommend_doctor",
            description: "Recommend a doctor based on specialty",
            parameters: {
              type: "object",
              properties: {
                speciality: {
                  type: "string",
                  description:
                    " The medical specialty (e.g. Neurologist, Dentist, General Physician)",
                },
              },
              required: ["speciality"],
            },
          },
        },
      ],
      tool_choice: "auto",
      stream: true,
    });

    let fullAnswer = "";
    let toolCallData: any = null;

    // 2️⃣ Process the stream
    for await (const chunk of stream) {
      // Handle Text Content
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        fullAnswer += content;
        sendStreamChunkToUser(userId, content);
      }

      // Handle Tool Calls (Accumulate chunks)
      const toolCalls = chunk.choices[0]?.delta?.tool_calls;
      if (toolCalls) {
        if (!toolCallData) {
          toolCallData = {
            name: toolCalls[0].function?.name,
            arguments: "",
          };
        }
        if (toolCalls[0].function?.arguments) {
          toolCallData.arguments += toolCalls[0].function.arguments;
        }
      }
    }

    // Fallback if no response was generated (and no tool called)
    if (!fullAnswer && !toolCallData) {
      fullAnswer = "Sorry, I couldn't generate a response.";
      sendStreamChunkToUser(userId, fullAnswer);
    }

    // 3️⃣ Process Tool Call if exists (Find Doctor)
    let recommenedDoctorId: string | null = null;
    let recommendDoctor: any = null;

    if (toolCallData && toolCallData.name === "recommend_doctor") {
      try {
        const args = JSON.parse(toolCallData.arguments);
        const speciality = args.speciality;
        console.log("🔍 AI Recommended Specialty:", speciality);

        // 1️⃣ Try to find a doctor with the specific specialty
        let doctor = await prisma.doctor.findFirst({
          where: {
            speciality: {
              contains: speciality,
              mode: "insensitive",
            },
          },
          include: {
            user: {
              select: {
                fullName: true,
                profileImage: true,
                id: true,
              },
            },
          },
        });

        // 2️⃣ Fallback: If no specialist found, get ANY doctor
        if (!doctor) {
          console.log(
            `⚠️ No ${speciality} found. Fetching any available doctor...`,
          );
          doctor = await prisma.doctor.findFirst({
            include: {
              user: {
                select: {
                  fullName: true,
                  profileImage: true,
                  id: true,
                  doctor: {
                    select: {
                      speciality: true,
                      experience: true,
                      consultFee: true,
                    },
                  },
                },
              },
            },
          });
        }

        if (doctor) {
          recommenedDoctorId = doctor.id;
          recommendDoctor = doctor;
          console.log(
            "✅ Doctor suggested:",
            doctor.id,
            `(${doctor.speciality})`,
          );

          // Send doctor info to user
          sendDoctorRecommendationToUser(userId, doctor);
        } else {
          console.log("⚠️ No doctors available in the database at all.");
        }
      } catch (err) {
        console.error("❌ Error parsing tool args:", err);
      }
    }

    // 4️⃣ Save complete answer to database
    const chatMessage = await prisma.chat.create({
      data: {
        userId,
        question,
        answer: fullAnswer || "Checking for doctors...", // If only tool was called, text might be empty
        doctorId: recommenedDoctorId,
      },
    });

    // 5️⃣ Send stream end signal
    sendStreamEndToUser(
      userId,
      chatMessage.id,
      chatMessage.createdAt.toISOString(),
    );

    // 6️⃣ Return response
    return {
      type: "messageResponse",
      question: chatMessage.question,
      answer: chatMessage.answer,
      doctor: recommendDoctor,
      createdAt: chatMessage.createdAt.toISOString(),
    };
  } catch (error: any) {
    console.error("❌ Error in createChat:", error);
    const errorMessage =
      "Sorry, an error occurred while processing your request.";
    sendStreamEndToUser(userId, null, new Date().toISOString(), errorMessage);
    throw error;
  }
};

export const chatService = {
  createChat,
};
