import prisma from "../../shared/prisma";

// Generate N-digit random number as string
const generateRandomDigits = (length: number): string => {
  let result = "";
  const digits = "0123456789";

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * digits.length);
    result += digits[randomIndex];
  }

  // Ensure first digit is not zero
  if (result[0] === "0") {
    result = (Math.floor(Math.random() * 9) + 1).toString() + result.slice(1);
  }

  return result;
};

// Determine current digit length (12 → 15)
const getCurrentDigitLength = async (): Promise<number> => {
  const lastCard = await prisma.prepaidCard.findFirst({
    orderBy: { createdAt: "desc" },
    select: { cardNumber: true },
  });

  if (!lastCard) return 12;

  return Math.min(lastCard.cardNumber.length, 15);
};

// Generate unique card number with retries
export const generateUniqueCardNumber = async (): Promise<string> => {
  let digitLength = await getCurrentDigitLength();

  while (digitLength <= 15) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const cardNumber = generateRandomDigits(digitLength);

      const exists = await prisma.prepaidCard.findUnique({
        where: { cardNumber },
      });

      if (!exists) {
        return cardNumber;
      }
    }

    // Too many collisions → move to next digit length
    digitLength++;
  }

  throw new Error("Unable to generate unique prepaid card number");
};
