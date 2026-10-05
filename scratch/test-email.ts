import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "../.env") });

import emailSender from "../src/helpars/emailSender/emailSender";
import { otpEmail } from "../src/emails/otpEmail";

async function test() {
  console.log("Sending test email to mohosinali075@gmail.com...");
  try {
    await emailSender(
      "Salama Healthcare - Test Password Reset Code",
      "mohosinali075@gmail.com",
      otpEmail("849201")
    );
    console.log("SUCCESS: Email sent successfully to mohosinali075@gmail.com!");
  } catch (err) {
    console.error("ERROR: Failed to send email:", err);
  }
}

test();
