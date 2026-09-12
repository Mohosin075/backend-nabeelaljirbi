import prisma from "../../shared/prisma";
import { getConnectedUsers } from "./socketHandler";

// Original function - kept for backwards compatibility
export const sendResponseToUser = async (senderId: string, question: string, answer: string) => {
  const senderPresence = getConnectedUsers().get(senderId);
  
  if (senderPresence && senderPresence.ws) {
    senderPresence.ws.send(
      JSON.stringify({
        type: "messageResponse",
        question,
        answer,
        createdAt: new Date().toISOString(),
      })
    );
    
    console.log(`✅ Socket notification sent to user ${senderId}: messageResponse`);
  } else {
    console.log(`⚠️ User ${senderId} is offline. Message saved to database.`);
  }
};

// 🆕 Send a streaming chunk to the user
export const sendStreamChunkToUser = (userId: string, chunk: string) => {
  const userPresence = getConnectedUsers().get(userId);
  
  if (userPresence && userPresence.ws) {
    userPresence.ws.send(
      JSON.stringify({
        type: "streamChunk",
        chunk,
        timestamp: new Date().toISOString(),
      })
    );
    
    console.log(`📤 Stream chunk sent to user ${userId}`);
  } else {
    console.log(`⚠️ User ${userId} is offline. Cannot send stream chunk.`);
  }
};

// 🆕 Send stream start signal
export const sendStreamStartToUser = (userId: string, question: string) => {
  const userPresence = getConnectedUsers().get(userId);
  
  if (userPresence && userPresence.ws) {
    userPresence.ws.send(
      JSON.stringify({
        type: "streamStart",
        question,
        timestamp: new Date().toISOString(),
      })
    );
    
    console.log(`🚀 Stream started for user ${userId}`);
  } else {
    console.log(`⚠️ User ${userId} is offline. Cannot start stream.`);
  }
};

// 🆕 Send stream end signal with complete message info
export const sendStreamEndToUser = (
  userId: string, 
  messageId: string | null, 
  timestamp: string,
  error?: string
) => {
  const userPresence = getConnectedUsers().get(userId);
  
  if (userPresence && userPresence.ws) {
    userPresence.ws.send(
      JSON.stringify({
        type: "streamEnd",
        messageId,
        timestamp,
        error: error || null,
      })
    );
    
    console.log(`✅ Stream ended for user ${userId}${error ? ' with error' : ''}`);
  } else {
    console.log(`⚠️ User ${userId} is offline. Cannot end stream.`);
  }
};

// 🆕 Send doctor recommendation
export const sendDoctorRecommendationToUser = (userId: string, doctor: any) => {
  const userPresence = getConnectedUsers().get(userId);
  
  if (userPresence && userPresence.ws) {
    userPresence.ws.send(
      JSON.stringify({
        type: "doctorRecommendation",
        doctor,
        timestamp: new Date().toISOString(),
      })
    );
    
    console.log(`👨‍⚕️ Doctor recommendation sent to user ${userId}`);
  } else {
    console.log(`⚠️ User ${userId} is offline. Cannot send recommendation.`);
  }
};