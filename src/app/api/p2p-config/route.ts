import { NextResponse } from "next/server";

interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

interface CloudflareIceResponse {
  iceServers: IceServer[];
}

interface P2PConfig {
  appId: string;
  supabaseKey: string;
  rtcConfig: {
    iceServers: IceServer[];
  };
}

export async function GET() {
  try {
    const appId = process.env.SUPABASE_URL || "";
    const supabaseKey = process.env.SUPABASE_ANON_KEY || "";
    const turnId = process.env.CLOUDFLARE_TURN_ID || "";
    const turnApi = process.env.CLOUDFLARE_TURN_API || "";

    if (!appId || !supabaseKey) {
      console.error("Missing Supabase configuration");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 },
      );
    }

    let iceServers: IceServer[] = [];

    if (turnId && turnApi) {
      try {
        const cloudflareResponse = await fetch(
          `https://rtc.live.cloudflare.com/v1/turn/keys/${turnId}/credentials/generate-ice-servers`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${turnApi}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ ttl: 43200 }), // 12 hours
          },
        );

        if (!cloudflareResponse.ok) {
          console.error(
            "Cloudflare TURN API error:",
            cloudflareResponse.status,
            await cloudflareResponse.text(),
          );
          // fallback
          iceServers = [
            { urls: ["stun:stun.cloudflare.com:3478"] },
            { urls: ["stun:stun.l.google.com:19302"] },
          ];
        } else {
          const data: CloudflareIceResponse = await cloudflareResponse.json();
          iceServers = data.iceServers;
          console.log("Successfully fetched Cloudflare TURN credentials");
        }
      } catch (error) {
        console.error("Failed to fetch Cloudflare TURN credentials:", error);
        iceServers = [
          { urls: ["stun:stun.cloudflare.com:3478"] },
          { urls: ["stun:stun.l.google.com:19302"] },
        ];
      }
    } else {
      console.warn("Cloudflare TURN not configured, using STUN only");
      iceServers = [
        { urls: ["stun:stun.cloudflare.com:3478"] },
        { urls: ["stun:stun.l.google.com:19302"] },
      ];
    }

    const config: P2PConfig = {
      appId,
      supabaseKey,
      rtcConfig: {
        iceServers,
      },
    };

    return NextResponse.json(config, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  } catch (error) {
    console.error("P2P config API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
