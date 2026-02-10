import { NextResponse } from "next/server";
import { GoogleGenAI, Modality } from "@google/genai";

// Gemini Live API configuration — locked into the ephemeral token server-side.
// The client cannot see or modify these values.
const GEMINI_CONFIG = {
  model: "gemini-2.5-flash-preview",
  systemInstruction:
    "You are a friendly assistant. Keep responses brief and conversational. Start by greeting the user when conversation starts.",
  voiceName: "Aoede",
  thinkingBudget: 0,
  initialMessage: "Hello",
};

export async function GET() {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      return NextResponse.json(
        { error: "Gemini API key not configured" },
        { status: 500 }
      );
    }

    const mascotBotApiKey = process.env.MASCOT_BOT_API_KEY;
    if (!mascotBotApiKey) {
      return NextResponse.json(
        { error: "Mascot Bot API key not configured" },
        { status: 500 }
      );
    }

    // 1. Create Google ephemeral token with locked config
    const ai = new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: { apiVersion: "v1alpha" },
    });

    const googleToken = await ai.authTokens.create({
      config: {
        uses: 1, // Single-use token
        liveConnectConstraints: {
          model: GEMINI_CONFIG.model,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: {
              parts: [{ text: GEMINI_CONFIG.systemInstruction }],
            },
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: GEMINI_CONFIG.voiceName },
              },
            },
            generationConfig: {
              thinkingConfig: { thinkingBudget: GEMINI_CONFIG.thinkingBudget },
            },
          },
        },
        httpOptions: { apiVersion: "v1alpha" },
      },
    });

    // 2. Get Mascot Bot proxy token (wraps the Google ephemeral token)
    const response = await fetch("https://api.mascot.bot/v1/get-signed-url", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mascotBotApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        config: {
          provider: "gemini",
          provider_config: {
            ephemeral_token: googleToken.name,
            model: GEMINI_CONFIG.model,
          },
        },
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to get signed URL:", errorText);
      throw new Error("Failed to get signed URL");
    }

    const data = await response.json();

    // 3. Return connection info — config is NOT exposed to the client
    return NextResponse.json({
      baseUrl: "https://api.mascot.bot",
      ephemeralToken: data.api_key,
      model: GEMINI_CONFIG.model,
      initialMessage: GEMINI_CONFIG.initialMessage,
    });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      { error: "Failed to generate signed URL" },
      { status: 500 }
    );
  }
}

export const dynamic = "force-dynamic";
