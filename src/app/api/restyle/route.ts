import { NextResponse } from "next/server";
import OpenAI from "openai";

const openaiApiKey = process.env.OPENAI_API_KEY;
const openaiClient = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;

export async function POST(request: Request) {
  try {
    if (!openaiClient) {
      return NextResponse.json(
        { error: "OpenAI configuration missing." },
        { status: 500 }
      );
    }

    const payload = await request.json().catch(() => null);
    if (!payload) {
      return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
    }

    const { daw, plugins, stylePrompt } = payload;
    if (typeof daw !== "string" || !Array.isArray(plugins) || typeof stylePrompt !== "string") {
      return NextResponse.json(
        { error: "Missing daw, plugins, or stylePrompt." },
        { status: 400 }
      );
    }

    const systemPrompt = `You are ChainGen, an elite mix engineer. You will re-style an existing plugin chain for ${daw}.\nReturn ONLY JSON structured as { \"plugins\": [ { \"name\": string, \"type\": string, \"settings\": object, \"comment\": string } ] }.\nEnsure all plugin names are valid for ${daw}.`;

    const existingChain = JSON.stringify(plugins, null, 2);

    const response = await openaiClient.responses.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: systemPrompt,
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Here is the existing chain: ${existingChain}`,
            },
            {
              type: "input_text",
              text: `Re-style this chain with the following direction: ${stylePrompt}. Preserve reasonable gain staging and realistic settings. Remember to emit valid JSON only.`,
            },
          ],
        },
      ],
    });

    const rawContent = response.output_text;
    if (!rawContent) {
      return NextResponse.json({ error: "Model returned no content." }, { status: 502 });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch (error) {
      console.error("restyle parse error", error, rawContent);
      return NextResponse.json(
        { error: "Model response was not valid JSON." },
        { status: 502 }
      );
    }

    if (!parsed || typeof parsed !== "object") {
      return NextResponse.json(
        { error: "Model response missing plugins array." },
        { status: 502 }
      );
    }

    const maybePlugins = (parsed as { plugins?: unknown }).plugins;
    if (!Array.isArray(maybePlugins)) {
      return NextResponse.json(
        { error: "Model response missing plugins array." },
        { status: 502 }
      );
    }

    return NextResponse.json({ plugins: maybePlugins });
  } catch (error) {
    console.error("/api/restyle error", error);
    return NextResponse.json(
      { error: "Unable to re-style chain. Please try again later." },
      { status: 500 }
    );
  }
}
