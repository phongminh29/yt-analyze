import dayjs from "dayjs";
import { LRUCache } from "lru-cache";
import { z } from "zod";

const cache = new LRUCache({
  max: 500,
  ttl: 1000 * 60 * 60 * 6, // 6h
});

const BodySchema = z.object({
  inputs: z.array(z.string().min(1)).min(1).max(10),
  days: z.number().int().min(7).max(365).default(60),
  maxVideos: z.number().int().min(10).max(200).default(80),
});

const YT_BASE = "https://www.googleapis.com/youtube/v3";

function parseChannelInput(input) {
  const s = (input || "").trim();

  const m1 = s.match(/(UC[a-zA-Z0-9_-]{20,})/);
  if (m1) return { type: "id", value: m1[1] };

  const m2 = s.match(/youtube\.com\/@([^/?]+)/i);
  if (m2) return { type: "forHandle", value: `@${m2[1]}` };

  if (s.startsWith("@")) return { type: "forHandle", value: s };

  return { type: "forHandle", value: s };
}

async function ytGET(path, params, apiKey) {
  const url = new URL(`${YT_BASE}/${path}`);
  url.searchParams.set("key", apiKey);

  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString());
  const text = await res.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const msg = json?.error?.message || text || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return json;
}

async function resolveChannel(parsed, apiKey) {
  const params = {
    part: "id,snippet,contentDetails,statistics",
    maxResults: 1,
  };

  if (parsed.type === "id") params.id = parsed.value;
  if (parsed.type === "forHandle") params.forHandle = parsed.value;

  const res = await ytGET("channels", params, apiKey);
  const items = res.items || [];
  if (!items.length) throw new Error(`Không tìm thấy channel: ${parsed.value}`);

  const ch = items[0];
  return {
    channelId: ch.id,
    title: ch.snippet?.title,
    uploadsPlaylistId: ch.contentDetails?.relatedPlaylists?.uploads,
    subscribers: Number(ch.statistics?.subscriberCount || 0),
    totalViews: Number(ch.statistics?.viewCount || 0),
    videoCount: Number(ch.statistics?.videoCount || 0),
  };
}

async function listPlaylistVideos(playlistId, apiKey, maxVideos = 80) {
  let pageToken;
  const ids = [];

  while (ids.length < maxVideos) {
    const res = await ytGET(
      "playlistItems",
      {
        part: "contentDetails",
        playlistId,
        maxResults: Math.min(50, maxVideos - ids.length),
        pageToken,
      },
      apiKey
    );

    const items = res.items || [];
    for (const it of items) {
      const vid = it.contentDetails?.videoId;
      if (vid) ids.push(vid);
    }

    pageToken = res.nextPageToken;
    if (!pageToken || !items.length) break;
  }

  return ids;
}

async function getVideosDetails(videoIds, apiKey) {
  const out = [];

  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    const res = await ytGET(
      "videos",
      {
        part: "snippet,statistics,contentDetails",
        id: chunk.join(","),
        maxResults: 50,
      },
      apiKey
    );
    out.push(...(res.items || []));
  }

  return out;
}

function iso8601DurationToSeconds(d) {
  const m = String(d || "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const h = parseInt(m[1] || "0", 10);
  const mi = parseInt(m[2] || "0", 10);
  const s = parseInt(m[3] || "0", 10);
  return h * 3600 + mi * 60 + s;
}

function cleanTitle(t) {
  return (t || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractNgrams(titles, nMin = 2, nMax = 4) {
  const stop = new Set([
    "review",
    "tóm",
    "tắt",
    "phim",
    "full",
    "tập",
    "ep",
    "phần",
    "p1",
    "p2",
    "p3",
    "p4",
    "p5",
    "mới",
    "hay",
    "nhất",
    "và",
    "là",
    "của",
    "cho",
    "một",
    "những",
    "đã",
    "khi",
    "thì",
    "với",
    "trong",
    "từ",
    "đến",
  ]);

  const freq = new Map();

  for (const raw of titles) {
    const w = cleanTitle(raw)
      .split(" ")
      .filter(Boolean)
      .filter((x) => x.length >= 2 && !stop.has(x));

    for (let n = nMin; n <= nMax; n++) {
      for (let i = 0; i + n <= w.length; i++) {
        const gram = w.slice(i, i + n).join(" ");
        if (gram.split(" ").some((x) => stop.has(x))) continue;
        freq.set(gram, (freq.get(gram) || 0) + 1);
      }
    }
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([phrase, count]) => ({ phrase, count }));
}

function classifyHook(title) {
  const t = cleanTitle(title);
  const rules = [
    { k: "phế vật", tag: "Phế vật → nghịch thiên" },
    { k: "ruồng bỏ", tag: "Bị ruồng bỏ → quay lại" },
    { k: "quỳ xuống", tag: "Áp chế → quỳ xuống" },
    { k: "chấn động", tag: "Đột phá → chấn động" },
    { k: "xuyên không", tag: "Xuyên không" },
    { k: "hệ thống", tag: "Hệ thống" },
    { k: "trùng sinh", tag: "Trùng sinh" },
  ];
  for (const r of rules) if (t.includes(r.k)) return r.tag;
  return "Khác";
}

function computeVelocity({ views, likes, ageDays }) {
  const vpd = views / Math.max(1, ageDays);
  return Math.round(vpd * Math.log10(likes + 10));
}

export async function POST(req) {
  try {
    const apiKey = process.env.YT_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "Thiếu YT_API_KEY trong .env.local" }, { status: 500 });
    }

    const body = BodySchema.parse(await req.json());
    const cutoff = dayjs().subtract(body.days, "day");

    const allRows = [];
    const channels = [];

    for (const input of body.inputs) {
      const parsed = parseChannelInput(input);
      const cacheKey = JSON.stringify({ parsed, days: body.days, maxVideos: body.maxVideos });

      let cached = cache.get(cacheKey);
      if (!cached) {
        const ch = await resolveChannel(parsed, apiKey);
        if (!ch.uploadsPlaylistId) throw new Error(`Channel ${ch.title} không có uploads playlist`);

        const ids = await listPlaylistVideos(ch.uploadsPlaylistId, apiKey, body.maxVideos);
        const videos = await getVideosDetails(ids, apiKey);

        const rows = (videos || [])
          .map((v) => {
            const publishedAt = v.snippet?.publishedAt;
            const views = Number(v.statistics?.viewCount || 0);
            const likes = Number(v.statistics?.likeCount || 0);
            const comments = Number(v.statistics?.commentCount || 0);
            const durSec = iso8601DurationToSeconds(v.contentDetails?.duration || "PT0S");
            const ageDays = Math.max(1, dayjs().diff(dayjs(publishedAt), "day"));
            const viewsPerDay = Math.round(views / ageDays);
            const velocity = computeVelocity({ views, likes, ageDays });

            return {
              channelId: ch.channelId,
              channelTitle: ch.title,
              videoId: v.id,
              title: v.snippet?.title,
              publishedAt,
              durationSec: durSec,
              views,
              likes,
              comments,
              ageDays,
              viewsPerDay,
              velocity,
              hookTag: classifyHook(v.snippet?.title || ""),
              url: `https://www.youtube.com/watch?v=${v.id}`,
            };
          })
          .filter((r) => r.publishedAt && dayjs(r.publishedAt).isAfter(cutoff));

        const patterns = extractNgrams(rows.map((r) => r.title));
        const topByVelocity = [...rows].sort((a, b) => b.velocity - a.velocity).slice(0, 20);
        const topByVpd = [...rows].sort((a, b) => b.viewsPerDay - a.viewsPerDay).slice(0, 20);

        cached = { ch, rows, patterns, topByVelocity, topByVpd };
        cache.set(cacheKey, cached);
      }

      channels.push(cached.ch);
      allRows.push(...cached.rows);
    }

    // group by channelId (tương thích Node 18, không dùng Object.groupBy)
    const byChannel = new Map();
    for (const r of allRows) {
      const arr = byChannel.get(r.channelId) || [];
      arr.push(r);
      byChannel.set(r.channelId, arr);
    }

    const channelSummary = [...byChannel.entries()]
      .map(([channelId, rows]) => {
        const channelTitle = rows[0]?.channelTitle || channelId;
        const avgDurationSec = Math.round(rows.reduce((s, r) => s + r.durationSec, 0) / Math.max(1, rows.length));
        const avgViewsPerDay = Math.round(rows.reduce((s, r) => s + r.viewsPerDay, 0) / Math.max(1, rows.length));
        const avgVelocity = Math.round(rows.reduce((s, r) => s + r.velocity, 0) / Math.max(1, rows.length));

        const hooks = new Map();
        for (const r of rows) hooks.set(r.hookTag, (hooks.get(r.hookTag) || 0) + 1);

        const hookMix = [...hooks.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([tag, count]) => ({ tag, count }));

        return { channelId, channelTitle, videosInWindow: rows.length, avgDurationSec, avgViewsPerDay, avgVelocity, hookMix };
      })
      .sort((a, b) => b.avgVelocity - a.avgVelocity);

    const globalPatterns = extractNgrams(allRows.map((r) => r.title));
    const globalTopByVelocity = [...allRows].sort((a, b) => b.velocity - a.velocity).slice(0, 20);
    const globalTopByViewsPerDay = [...allRows].sort((a, b) => b.viewsPerDay - a.viewsPerDay).slice(0, 20);

    return Response.json({
      days: body.days,
      maxVideos: body.maxVideos,
      channels,
      channelSummary,
      globalTopByVelocity,
      globalTopByViewsPerDay,
      globalPatterns,
      rows: allRows,
    });
  } catch (e) {
    return Response.json({ error: e?.message || "Error" }, { status: 400 });
  }
}
