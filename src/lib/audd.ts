type AudDResponse = {
  status: string;
  result?: {
    title?: string;
    artist?: string;
    album?: string;
    release_date?: string;
    label?: string;
    timecode?: string;
    song_id?: string;
    score?: number;
    apple_music?: {
      url?: string;
      genreNames?: string[];
    };
    spotify?: {
      url?: string;
    };
    lyrics?: {
      lyrics?: string;
    };
  };
};

export type AudDSongMetadata = {
  title: string;
  artist: string;
  album: string | null;
  releaseDate: string | null;
  label: string | null;
  timecode: string | null;
  songId: string | null;
  score: number | null;
  appleMusicUrl: string | null;
  spotifyUrl: string | null;
  genres: string[];
  lyrics: string | null;
};

export async function identifySong(
  buffer: Buffer
): Promise<AudDSongMetadata | null> {
  const token = process.env.AUDD_API_TOKEN;
  if (!token) {
    console.warn("AUDD_API_TOKEN missing; skipping song recognition.");
    return null;
  }

  if (!buffer || buffer.length === 0) {
    return null;
  }

  try {
    const response = await fetch("https://api.audd.io/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_token: token,
        return: "apple_music,spotify,lyrics",
        audio: buffer.toString("base64"),
      }),
    });

    if (!response.ok) {
      console.warn("AudD request failed", response.status, response.statusText);
      return null;
    }

    const payload = (await response.json()) as AudDResponse;

    if (payload.status !== "success" || !payload.result) {
      return null;
    }

    const result = payload.result;
    const genres =
      result.apple_music?.genreNames ??
      (result.spotify ? [] : []);

    return {
      title: result.title ?? "Unknown title",
      artist: result.artist ?? "Unknown artist",
      album: result.album ?? null,
      releaseDate: result.release_date ?? null,
      label: result.label ?? null,
      timecode: result.timecode ?? null,
      songId: result.song_id ?? null,
      score: typeof result.score === "number" ? result.score : null,
      appleMusicUrl: result.apple_music?.url ?? null,
      spotifyUrl: result.spotify?.url ?? null,
      genres,
      lyrics: result.lyrics?.lyrics ?? null,
    };
  } catch (error) {
    console.warn("AudD request threw", error);
    return null;
  }
}
