import prisma from "../../shared/prisma";
import crypto from "crypto";

// Generate N-digit random number string securely
export const generateRandomDigits = (length: number): string => {
  const bytesNeeded = Math.ceil(length * 0.6); // 1 byte = 0-255 -> safe entropy
  const buffer = crypto.randomBytes(bytesNeeded);
  let result = "";

  for (let i = 0; i < length; i++) {
    const byte = buffer[i % buffer.length];
    result += (byte + Math.floor(Math.random() * 10)) % 10;
  }

  // Ensure first digit is not zero
  if (result[0] === "0") {
    result = (Math.floor(Math.random() * 9) + 1).toString() + result.slice(1);
  }

  return result;
};

// Determine current digit length (12 → 15)
export const getCurrentDigitLength = async (): Promise<number> => {
  const lastCard = await prisma.prepaidCard.findFirst({
    orderBy: { createdAt: "desc" },
    select: { cardNumber: true },
  });

  if (!lastCard || !lastCard.cardNumber) return 12;

  return Math.min(Math.max(lastCard.cardNumber.length, 12), 15);
};

/**
 * Generate a batch of unique card numbers efficiently at scale.
 * Eliminates N database roundtrips by generating candidates in-memory
 * and checking collisions with a single batch `IN` query.
 */
export const generateUniqueCardNumbersBatch = async (quantity: number): Promise<string[]> => {
  if (quantity <= 0) return [];

  let digitLength = await getCurrentDigitLength();
  const uniqueCardNumbers = new Set<string>();

  while (uniqueCardNumbers.size < quantity && digitLength <= 15) {
    const needed = quantity - uniqueCardNumbers.size;
    const candidateSet = new Set<string>();

    // Generate in-memory candidates with buffer to account for possible collisions
    const targetCandidateCount = Math.ceil(needed * 1.1) + 10;
    while (candidateSet.size < targetCandidateCount) {
      const num = generateRandomDigits(digitLength);
      if (!uniqueCardNumbers.has(num)) {
        candidateSet.add(num);
      }
    }

    const candidateArray = Array.from(candidateSet);

    // Batch query DB in slices of 1000 to avoid query size limits
    const existingInDb = new Set<string>();
    const chunkSize = 1000;
    for (let i = 0; i < candidateArray.length; i += chunkSize) {
      const chunk = candidateArray.slice(i, i + chunkSize);
      const existing = await prisma.prepaidCard.findMany({
        where: {
          cardNumber: { in: chunk },
        },
        select: { cardNumber: true },
      });
      existing.forEach((c) => existingInDb.add(c.cardNumber));
    }

    // Add verified unique numbers to our final set
    for (const num of candidateArray) {
      if (!existingInDb.has(num)) {
        uniqueCardNumbers.add(num);
        if (uniqueCardNumbers.size === quantity) break;
      }
    }

    // If collisions were too high, increment digit length
    if (uniqueCardNumbers.size < quantity) {
      digitLength++;
    }
  }

  if (uniqueCardNumbers.size < quantity) {
    throw new Error("Unable to generate requested quantity of unique prepaid card numbers");
  }

  return Array.from(uniqueCardNumbers);
};

// Generate unique card number with retries (convenience wrapper)
export const generateUniqueCardNumber = async (): Promise<string> => {
  const [cardNumber] = await generateUniqueCardNumbersBatch(1);
  return cardNumber;
};
