// src/helpars/socket/socketHandler.ts
import WebSocket, { WebSocketServer } from "ws";
import { Server as HTTPServer } from "http";
import prisma from "../../shared/prisma";
import { socketAuth } from "./socketAuth";
import { chatService } from "../../app/modules/AIChat/chat.service";

// --- In-memory storage for connected users ---
interface Presence {
  ws: WebSocket;
  status: "active" | "inactive";
  lastSeen: Date | null;
}

const connectedUsers = new Map<string, Presence>();

// --- Initialize WebSocket ---
export function initializeWebSocket(server: HTTPServer) {
  const wss = new WebSocketServer({ server, path: "/ws/" });
  console.log("✅ WebSocket server running on path: /ws/");

  wss.on("connection", async (ws: WebSocket, req) => {
    try {
      console.log("🔍 WS Connection Debug");
      console.log("  - URL:", req.url);
      console.log("  - Authorization header:", req.headers["authorization"]);
      console.log("  - Query params:", req.url?.split("?")[1]);

      // Get token from authorization header or query params
      let token = req.headers["authorization"] as string;
      
      // If not in header, try to get from query params
      if (!token && req.url) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        token = url.searchParams.get("token") || "";
      }

      if (!token) {
        console.error("❌ No token provided");
        ws.send(JSON.stringify({ type: "error", message: "Unauthorized: Token required" }));
        ws.close();
        return;
      }

      // Remove 'Bearer ' prefix if present
      token = token.replace(/^Bearer\s+/i, "");

      console.log("✅ Token found, length:", token.length);

      // Authenticate user
      const verifiedUser = await socketAuth(token);
      const userId = verifiedUser.id;

      // Save connection
      connectedUsers.set(userId, { ws, status: "active", lastSeen: null });
      console.log(`🟢 User ${userId} connected via WebSocket`);

      // Send connection confirmation
      ws.send(
        JSON.stringify({
          type: "connected",
          message: `User ${userId} authenticated & connected`,
          userId: userId,
        })
      );

      // ---------------- HANDLE INCOMING MESSAGES ----------------
      ws.on("message", async (msg) => {
        try {
          const data = JSON.parse(msg.toString());
          console.log("📩 Incoming message:", data);

          // ---------------- SEND MESSAGE ----------------
          if (data.type === "sendMessage") {
            const { question } = data;

            console.log("📝 Question from user:", userId, question);

            // // Save message to database
            // const chatMessage = await prisma.chat.create({
            //   data: {
            //     userId: userId,
            //     question: question,
            //     answer: "This is a placeholder response. Implement your chat logic here.",
            //   },
            // });

            // console.log("✅ Chat Message saved:", chatMessage.id);

            // // Send back to sender
            // ws.send(
            //   JSON.stringify({
            //     type: "messageResponse",
            //     question: chatMessage.question,
            //     answer: chatMessage.answer,
            //     createdAt: chatMessage.createdAt.toISOString(),
            //   })
            // );

            await chatService.createChat(userId, question);
          }
          // ---------------- LOAD PREVIOUS MESSAGES ----------------
          if (data.type === "loadMessages") {
            const { page = 1, limit = 20 } = data;
            const skip = (page - 1) * limit;

            const [messages, totalCount] = await Promise.all([
              prisma.chat.findMany({
                where: { userId: userId },
                orderBy: { createdAt: "desc" },
                skip,
                take: limit,
                include: {
                  doctor: {
                    select: {
                      speciality: true,
                      experience: true,
                      consultFee: true,
                      user: {
                        select: {
                          fullName: true,
                          profileImage: true,
                          id: true,
                        },
                      },
                    },
                  },
                },
              }),
              prisma.chat.count({
                where: { userId: userId },
              }),
            ]);

            ws.send(
              JSON.stringify({
                type: "messagesLoaded",
                page,
                limit,
                totalCount,
                totalPages: Math.ceil(totalCount / limit),
                messages: messages.reverse(), // chronological order
              })
            );
          }

          // ---------------- TYPING INDICATOR ----------------
          if (data.type === "typing") {
            // You can broadcast to other users if needed
            const { isTyping } = data;
            console.log(`User ${userId} is ${isTyping ? "typing" : "stopped typing"}`);
          }

          // ---------------- MANUAL DISCONNECT ----------------
          if (data.type === "disconnect") {
            const presence = connectedUsers.get(userId);
            if (presence) {
              presence.ws.close();
            }
          }
        } catch (error: any) {
          console.error("❌ Error processing message:", error);
          ws.send(JSON.stringify({ type: "error", message: "Invalid data or server error" }));
        }
      });

      // ---------------- HANDLE SOCKET CLOSE ----------------
      ws.on("close", () => {
        const presence = connectedUsers.get(userId);
        if (presence) {
          connectedUsers.delete(userId);
          presence.lastSeen = new Date();
          console.log(
            `🔴 User ${userId} disconnected. Last seen: ${presence.lastSeen}`
          );
        }
      });

      // ---------------- HANDLE ERRORS ----------------
      ws.on("error", (error) => {
        console.error(`❌ WebSocket error for user ${userId}:`, error);
      });

    } catch (err: any) {
      console.error("❌ WS Auth Error:", err.message);
      ws.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
      ws.close();
    }
  });

  return wss;
}

// Export connectedUsers for external access if needed
export function getConnectedUsers() {
  return connectedUsers;
}

// Utility to check if a user is online
export function isUserOnline(userId: string): boolean {
  return connectedUsers.has(userId);
}

// Utility to send message to a specific user
export function sendToUser(userId: string, message: any) {
  const presence = connectedUsers.get(userId);
  if (presence && presence.ws.readyState === WebSocket.OPEN) {
    presence.ws.send(JSON.stringify(message));
    return true;
  }
  return false;
}
