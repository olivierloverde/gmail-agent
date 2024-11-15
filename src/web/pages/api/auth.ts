import type { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ message: "User ID is required" });
  }

  // Verify that this userId matches your Telegram user ID
  if (userId !== process.env.TELEGRAM_USER_ID) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Generate JWT token
  const token = jwt.sign({ userId }, process.env.JWT_SECRET!, {
    expiresIn: "7d",
  });

  res.status(200).json({ token });
}
