import {
  sendStreamChunkToUser,
  sendStreamEndToUser,
  sendStreamStartToUser,
  sendDoctorRecommendationToUser,
} from "../../../helpars/socket/socketHelper";
import prisma from "../../../shared/prisma";
import openai from "../../../shared/openai";
import { getConnectedUsers } from "../../../helpars/socket/socketHandler";

const createChat = async (userId: string, question: string) => {
  const chatConfig = await prisma.allowAiChat.findFirst();
  const isEnable = chatConfig?.isEnable ?? true;
  const limit = chatConfig?.limit ?? 5;

  const senderPresence = getConnectedUsers().get(userId);

  // Check if AI chat is enabled by Admin
  if (!isEnable) {
    if (senderPresence && senderPresence.ws) {
      senderPresence.ws.send(
        JSON.stringify({
          type: "chatDisabled",
          message: "AI Assistant is currently disabled by administrator.",
          createdAt: new Date().toISOString(),
        })
      );
    }
    return "AI Assistant is currently disabled";
  }

  // Rolling 24-hour window tied to real clock time (Section 13)
  const rolling24HoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rolling24hChatCount = await prisma.chat.count({
    where: {
      userId: userId,
      createdAt: {
        gte: rolling24HoursAgo,
      },
    },
  });

  console.log(
    `🤖 User ${userId} rolling 24h count: ${rolling24hChatCount} / ${limit}`
  );

  if (rolling24hChatCount >= limit) {
    // Find oldest message in current window to calculate next available reset
    const oldestInWindow = await prisma.chat.findFirst({
      where: {
        userId: userId,
        createdAt: { gte: rolling24HoursAgo },
      },
      orderBy: { createdAt: "asc" },
    });

    const nextAvailableAt = oldestInWindow
      ? new Date(oldestInWindow.createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString()
      : new Date(Date.now() + 60 * 60 * 1000).toISOString();

    if (senderPresence && senderPresence.ws) {
      senderPresence.ws.send(
        JSON.stringify({
          type: "limitExceeded",
          message: `You have reached your limit of ${limit} free messages per rolling 24-hour window.`,
          limit,
          usedCount: rolling24hChatCount,
          remainingCount: 0,
          nextAvailableAt,
          createdAt: new Date().toISOString(),
        })
      );
    }
    return "You have reached the rolling 24-hour limit";
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

    // 5.1️⃣ Send updated remaining count to user (Section 13)
    const newUsedCount = rolling24hChatCount + 1;
    const newRemainingCount = Math.max(0, limit - newUsedCount);
    if (senderPresence && senderPresence.ws) {
      senderPresence.ws.send(
        JSON.stringify({
          type: "userUsageConfig",
          isEnable,
          limit,
          usedCount: newUsedCount,
          remainingCount: newRemainingCount,
        })
      );
    }

    // 6️⃣ Return response
    return {
      type: "messageResponse",
      question: chatMessage.question,
      answer: chatMessage.answer,
      doctor: recommendDoctor,
      createdAt: chatMessage.createdAt.toISOString(),
      remainingCount: newRemainingCount,
      limit,
    };
  } catch (error: any) {
    console.error("❌ Error in createChat:", error);
    const errorMessage =
      "Sorry, an error occurred while processing your request.";
    sendStreamEndToUser(userId, null, new Date().toISOString(), errorMessage);
    throw error;
  }
};

const getUserUsage = async (userId: string) => {
  const rolling24HoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [rolling24hChatCount, chatConfig] = await Promise.all([
    prisma.chat.count({
      where: {
        userId,
        createdAt: { gte: rolling24HoursAgo },
      },
    }),
    prisma.allowAiChat.findFirst(),
  ]);

  const limit = chatConfig?.limit ?? 5;
  const isEnable = chatConfig?.isEnable ?? true;
  const remainingCount = Math.max(0, limit - rolling24hChatCount);

  return {
    isEnable,
    limit,
    usedCount: rolling24hChatCount,
    remainingCount,
  };
};

export const chatService = {
  createChat,
  getUserUsage,
};
