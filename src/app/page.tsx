"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoogleGenAI } from "@google/genai";
import type { Session } from "@google/genai";
import {
  Alignment,
  Fit,
  MascotClient,
  MascotProvider,
  MascotRive,
  useMascotLiveAPI,
} from "@mascotbot-sdk/react";

interface LiveAPISession {
  status: "disconnected" | "disconnecting" | "connecting" | "connected";
}

function GeminiLiveAPIContent() {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  // Session state for tracking connection status
  const [sessionStatus, setSessionStatus] =
    useState<LiveAPISession["status"]>("disconnected");
  const liveSessionRef = useRef<Session | null>(null);

  // Cached signed URL config for faster connection
  const [cachedConfig, setCachedConfig] = useState<{
    baseUrl: string;
    ephemeralToken: string;
    model: string;
    initialMessage: string;
  } | null>(null);
  const urlRefreshInterval = useRef<NodeJS.Timeout | null>(null);
  const connectionStartTime = useRef<number | null>(null);

  // Audio context and stream for microphone input
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  // Video capture refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Natural lip sync settings — memoized for stable reference
  const lipSyncConfig = useMemo(
    () => ({
      minVisemeInterval: 40,
      mergeWindow: 60,
      keyVisemePreference: 0.6,
      preserveSilence: true,
      similarityThreshold: 0.4,
      preserveCriticalVisemes: true,
      criticalVisemeMinDuration: 80,
    }),
    []
  );

  // Memoize session object to prevent unnecessary re-renders
  const session: LiveAPISession = useMemo(
    () => ({ status: sessionStatus }),
    [sessionStatus]
  );

  // Core integration hook — intercepts WebSocket and handles lip-sync + audio playback
  const { isIntercepting, messageCount } = useMascotLiveAPI({
    session,
    debug: false,
    gesture: true,
    naturalLipSync: true,
    naturalLipSyncConfig: lipSyncConfig,
  });

  // Check if mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Fetch signed URL config from backend
  const getSignedUrlConfig = async () => {
    const response = await fetch(`/api/get-signed-url-gemini?t=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!response.ok) {
      throw new Error(`Failed to get signed url: ${response.statusText}`);
    }
    return response.json();
  };

  // Fetch and cache signed URL config
  const fetchAndCacheConfig = useCallback(async () => {
    try {
      const config = await getSignedUrlConfig();
      setCachedConfig(config);
    } catch (error) {
      console.error("Failed to fetch signed URL config:", error);
      setCachedConfig(null);
    }
  }, []);

  // Pre-fetch token on mount + refresh every 9 minutes
  useEffect(() => {
    fetchAndCacheConfig();
    urlRefreshInterval.current = setInterval(
      () => fetchAndCacheConfig(),
      9 * 60 * 1000
    );
    return () => {
      if (urlRefreshInterval.current) {
        clearInterval(urlRefreshInterval.current);
        urlRefreshInterval.current = null;
      }
    };
  }, [fetchAndCacheConfig]);

  // Set up audio + video input processing
  const setupMediaInput = (liveSession: Session, stream: MediaStream) => {
    // --- Audio setup (Gemini expects 16kHz PCM16) ---
    audioContextRef.current = new AudioContext({ sampleRate: 16000 });
    const source = audioContextRef.current.createMediaStreamSource(stream);
    const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (e) => {
      if (!liveSessionRef.current || isMuted) return;

      const inputData = e.inputBuffer.getChannelData(0);
      const pcmData = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      const uint8Array = new Uint8Array(pcmData.buffer);
      const base64 = btoa(
        String.fromCharCode.apply(null, Array.from(uint8Array))
      );

      liveSession.sendRealtimeInput({
        audio: { data: base64, mimeType: "audio/pcm;rate=16000" },
      });
    };

    source.connect(processor);
    processor.connect(audioContextRef.current.destination);

    // --- Video frame capture at 1 FPS ---
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (canvas && video) {
      const ctx = canvas.getContext("2d");
      videoIntervalRef.current = setInterval(() => {
        if (!liveSessionRef.current || !ctx || !isVideoEnabled) return;
        if (video.readyState < video.HAVE_CURRENT_DATA) return;

        canvas.width = 768;
        canvas.height = 768;
        // Draw video centered/cropped to square
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const size = Math.min(vw, vh);
        const sx = (vw - size) / 2;
        const sy = (vh - size) / 2;
        ctx.drawImage(video, sx, sy, size, size, 0, 0, 768, 768);

        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        const base64 = dataUrl.split(",")[1];

        liveSession.sendRealtimeInput({
          video: { data: base64, mimeType: "image/jpeg" },
        });
      }, 1000);
    }
  };

  // Cleanup audio + video resources
  const cleanupMediaInput = () => {
    if (videoIntervalRef.current) {
      clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }
    processorRef.current?.disconnect();
    processorRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  // Start conversation using Google Gen AI SDK
  const startConversation = useCallback(async () => {
    try {
      setIsConnecting(true);
      setSessionStatus("connecting");
      connectionStartTime.current = Date.now();

      // Get microphone + camera access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      mediaStreamRef.current = stream;

      // Attach video stream to preview element
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // Use cached config if available, otherwise fetch fresh
      let config = cachedConfig;
      if (!config) {
        config = await getSignedUrlConfig();
      }

      if (!config?.baseUrl || !config?.ephemeralToken) {
        throw new Error("Failed to get signed URL config");
      }

      const { baseUrl, ephemeralToken, model, initialMessage } = config;

      // Initialize Google Gen AI SDK with Mascot Bot proxy as baseUrl
      const ai = new GoogleGenAI({
        apiKey: ephemeralToken,
        httpOptions: { baseUrl },
      });

      // Connect — config is locked in the ephemeral token, not sent from client
      const liveSession = await ai.live.connect({
        model,
        callbacks: {
          onopen: () => {
            if (connectionStartTime.current) {
              const elapsed = Date.now() - connectionStartTime.current;
              console.log(`Connection established in ${elapsed}ms`);
              connectionStartTime.current = null;
            }
          },
          onmessage: () => {
            // Audio messages are handled automatically by useMascotLiveAPI
            // via WebSocket interception — no manual handling needed here
          },
          onerror: (error) => {
            console.error("Gemini error:", error);
            setSessionStatus("disconnected");
            setIsConnecting(false);
            setCachedConfig(null);
            fetchAndCacheConfig();
          },
          onclose: () => {
            setSessionStatus("disconnected");
            cleanupMediaInput();
            setCachedConfig(null);
            fetchAndCacheConfig();
          },
        },
      });

      liveSessionRef.current = liveSession;
      setSessionStatus("connected");
      setIsConnecting(false);

      // Send initial message to trigger assistant greeting
      if (initialMessage) {
        liveSession.sendClientContent({
          turns: initialMessage,
          turnComplete: true,
        });
      }

      // Start streaming microphone + video
      setupMediaInput(liveSession, stream);
    } catch (error) {
      console.error("Failed to start conversation:", error);
      setIsConnecting(false);
      setSessionStatus("disconnected");
      connectionStartTime.current = null;
    }
  }, [cachedConfig, fetchAndCacheConfig]);

  // Stop conversation
  const stopConversation = useCallback(() => {
    setSessionStatus("disconnecting");
    liveSessionRef.current?.close();
    liveSessionRef.current = null;
    cleanupMediaInput();
  }, []);

  // Toggle mute
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  // Toggle video
  const toggleVideo = useCallback(() => {
    setIsVideoEnabled((prev) => {
      const newState = !prev;
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getVideoTracks().forEach((track) => {
          track.enabled = newState;
        });
      }
      return newState;
    });
  }, []);

  const isConnected = sessionStatus === "connected";

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-[#1a1a2e] to-[#16213e] overflow-hidden">
      <div className="h-screen w-full flex items-center justify-center">
        <div className="relative w-full h-full">
          {/* Mascot wrapper with mobile-specific sizing */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={
              isMobile
                ? {
                    transform: "scale(1.3)",
                    width: "130%",
                    height: "130%",
                    left: "-15%",
                    top: "-15%",
                  }
                : {}
            }
          >
            <MascotRive />
          </div>

          {/* Bottom gradient overlay */}
          <div
            className="absolute bottom-0 left-0 right-0 h-48 pointer-events-none"
            style={{
              background:
                "linear-gradient(to top, rgba(26, 26, 46, 0.9), transparent)",
            }}
          />

          {/* Camera preview (picture-in-picture) */}
          <div
            className={`absolute bottom-32 right-4 z-20 rounded-xl overflow-hidden shadow-lg border border-white/20 transition-opacity ${
              isConnected ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
            style={{ width: 160, height: 120 }}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
              style={{
                transform: "scaleX(-1)",
                opacity: isVideoEnabled ? 1 : 0.3,
              }}
            />
            {!isVideoEnabled && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white/70 text-xs">
                Camera Off
              </div>
            )}
          </div>

          {/* Offscreen canvas for frame capture */}
          <canvas ref={canvasRef} className="hidden" />

          {/* Status indicator */}
          {isIntercepting && (
            <div className="absolute top-4 right-4 text-white/60 text-sm z-20">
              Messages: {messageCount}
            </div>
          )}

          {/* Controls */}
          <div className="absolute bottom-12 left-1/2 transform -translate-x-1/2 flex gap-4 z-10">
            {!isConnected ? (
              <button
                onClick={startConversation}
                disabled={isConnecting}
                className="inline-flex items-center justify-center gap-x-2.5 h-16 px-8 text-lg rounded-lg bg-gradient-to-r from-[#f39c12] to-[#e67e22] text-white hover:from-[#d68910] hover:to-[#ca6f1e] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg"
              >
                {isConnecting ? "Connecting..." : "Start Call"}
              </button>
            ) : (
              <>
                <button
                  onClick={stopConversation}
                  className="inline-flex items-center justify-center gap-x-2.5 h-16 px-8 text-lg rounded-lg bg-gradient-to-r from-[#7b68ee] to-[#6a5acd] text-white hover:from-[#6b5dd3] hover:to-[#5a4abd] transition-all shadow-lg"
                >
                  End Call
                </button>
                <button
                  onClick={toggleMute}
                  className={`inline-flex items-center justify-center gap-x-2.5 h-16 px-8 text-lg rounded-lg transition-all shadow-lg ${
                    isMuted
                      ? "bg-gradient-to-r from-[#5dade2] to-[#3498db] text-white hover:from-[#4d9fd2] hover:to-[#2488cb]"
                      : "bg-gradient-to-r from-[#34495e] to-[#2c3e50] text-white hover:from-[#2c3e50] hover:to-[#1c2e40]"
                  }`}
                >
                  {isMuted ? "Unmute" : "Mute"}
                </button>
                <button
                  onClick={toggleVideo}
                  className={`inline-flex items-center justify-center gap-x-2.5 h-16 px-8 text-lg rounded-lg transition-all shadow-lg ${
                    !isVideoEnabled
                      ? "bg-gradient-to-r from-[#e74c3c] to-[#c0392b] text-white hover:from-[#d44332] hover:to-[#a93226]"
                      : "bg-gradient-to-r from-[#34495e] to-[#2c3e50] text-white hover:from-[#2c3e50] hover:to-[#1c2e40]"
                  }`}
                >
                  {isVideoEnabled ? "Cam" : "Cam Off"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  // Add your mascot .riv file to the public folder
  // Available with Mascot Bot SDK subscription
  const mascotUrl = "/mascot.riv";

  return (
    <MascotProvider>
      <main className="flex h-svh flex-col bg-[#080808] overflow-hidden">
        <MascotClient
          src={mascotUrl}
          inputs={["is_speaking", "gesture", "character"]}
          layout={{
            fit: Fit.Contain,
            alignment: Alignment.Center,
          }}
        >
          <GeminiLiveAPIContent />
        </MascotClient>
      </main>
    </MascotProvider>
  );
}
