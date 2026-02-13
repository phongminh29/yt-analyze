import { google } from "googleapis";
import dayjs from "dayjs";

const youtube = google.youtube("v3");

function parseChannelInput(input) {
  // Accept:
  // - channelId: UCxxxx
  // - handle: @abc or abc
  // - url: https://www.youtube.com/@abc or /channel/UCxxx or /c/xxx
  const s = (input || "").trim();

  // channel id
  const m1 = s.match(/(UC[a-zA-Z0-9_-]{20,})/);
  if (m1) return { type: "id", value: m1[1] };

  // handle in url
  const m2 = s.match(/youtube\.com\/@([^/?]+)/i);
  if (m2) return { type: "forHandle", value: `@${m2[1]}` };

  // handle direct
  if (s.startsWith("@")) return { type: "forHandle", value: s };

  // fallback: treat as handle (works if user inputs without @)
  return { type: "forHandle", value: s };
}

async function resolveChannel({ type, value }, apiKey) {
  const params = {
    key: apiKey,
    part: ["id", "snippet", "contentDetails", "statistics"],
    maxResults: 1,
  };

  if (type === "id") params.id = [value];
  if (type === "forHandle") params.forHandle = value; // supported per docs
  // forUsername optional if you want

  const res = await youtube.channels.list(params);
  const items = res.data.items || [];
  if (!items.length) throw new Error("Không tìm thấy channel từ input này.");

  const ch = items[0];
  const uploadsPlaylistId = ch.contentDetails?.relatedPlaylists?.uploads;
  return {
    channelId: ch.id,
    title: ch.snippet?.title,
    uploadsPlaylistId,
    subscribers: ch.statistics?.subscriberCount,
    totalViews: ch.statistics?.viewCount,
    videoCount: ch.statistics?.videoCount,
  };
}

async function listPlaylistVideos(playlistId, apiKey, maxVideos = 50) {
  let pageToken = undefined;
  const videoIds = [];

  while (videoIds.length < maxVideos) {
    const res = await youtube.playlistItems.list({
      key: apiKey,
      part: ["contentDetails", "snippet"],
      playlistId,
      maxResults: Math.min(50, maxVideos - videoIds.length),
      pageToken,
    });
    const items = res.data.items || [];
    for (const it of items) {
      const vid = it.contentDetails?.videoId;
      if (vid) videoIds.push(vid);
    }
    pageToken = res.data.nextPageToken;
    if (!pageToken || !items.length) break;
  }

  return videoIds;
}

async function getVideosDetails(videoIds, apiKey) {
  const chunks = [];
  for (let i = 0; i < videoIds.length; i += 50) chunks.push(videoIds.slice(i, i + 50));

  const out = [];
  for (const chunk of chunks) {
    const res = await youtube.videos.list({
      key: apiKey,
      part: ["snippet", "statistics", "contentDetails"],
      id: chunk,
      maxResults: 50,
    });
    out.push(...(res.data.items || []));
  }
  return out;
}

function iso8601DurationToSeconds(d) {
  // very small parser for PT#H#M#S
  const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const h = parseInt(m[1] || "0", 10);
  const mi = parseInt(m[2] || "0", 10);
  const s = parseInt(m[3] || "0", 10);
  return h * 3600 + mi * 60 + s;
}

function extractTitlePatterns(titles) {
  // Simple: top words (VN + EN) excluding stopwords
  const stop = new Set([
    "là","và","của","cho","một","những","đã","khi","thì","với","trong","từ","phần",
    "review","tóm","tắt","phim","full","p1","p2","p3","p4","p5","ep","tập",
  ]);
  const freq = new Map();
  for (const t of titles) {
    const words = t
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean)
      .filter(w => w.length >= 3 && !stop.has(w));
    for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  }
  return [...freq.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 20)
    .map(([word, count]) => ({ word, count }));
}

export async function POST(req) {
  try {
    const body = await req.json();
    const input = body?.input || "";
    const days = Number(body?.days || 60);
    const maxVideos = Number(body?.maxVideos || 50);

    const apiKey = process.env.YT_API_KEY;
    if (!apiKey) return Response.json({ error: "Thiếu YT_API_KEY trong .env.local" }, { status: 500 });

    const parsed = parseChannelInput(input);
    const channel = await resolveChannel(parsed, apiKey);

    if (!channel.uploadsPlaylistId) throw new Error("Channel không có uploads playlist.");

    const ids = await listPlaylistVideos(channel.uploadsPlaylistId, apiKey, maxVideos);
    const videos = await getVideosDetails(ids, apiKey);

    const cutoff = dayjs().subtract(days, "day");
    const rows = videos
      .map(v => {
        const publishedAt = v.snippet?.publishedAt;
        const views = Number(v.statistics?.viewCount || 0);
        const likes = Number(v.statistics?.likeCount || 0);
        const comments = Number(v.statistics?.commentCount || 0);
        const durSec = iso8601DurationToSeconds(v.contentDetails?.duration || "PT0S");
        const ageDays = Math.max(1, dayjs().diff(dayjs(publishedAt), "day"));
        const viewsPerDay = views / ageDays;

        return {
          videoId: v.id,
          title: v.snippet?.title,
          publishedAt,
          durationSec: durSec,
          views,
          likes,
          comments,
          viewsPerDay: Math.round(viewsPerDay),
          url: `https://www.youtube.com/watch?v=${v.id}`,
        };
      })
      .filter(r => dayjs(r.publishedAt).isAfter(cutoff))
      .sort((a,b) => b.viewsPerDay - a.viewsPerDay);

    const patterns = extractTitlePatterns(rows.map(r => r.title || ""));
    const top = rows.slice(0, 10);

    return Response.json({
      channel,
      days,
      count: rows.length,
      top,
      patterns,
      rows,
    });
  } catch (e) {
    return Response.json({ error: e?.message || "Error" }, { status: 400 });
  }
}
