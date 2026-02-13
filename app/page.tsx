"use client";

import React, { useMemo, useState } from "react";

type HookMix = { tag: string; count: number };

type ChannelSummary = {
  channelId: string;
  channelTitle: string;
  videosInWindow: number;
  avgDurationSec: number;
  avgViewsPerDay: number;
  avgVelocity: number;
  hookMix: HookMix[];
};

type Row = {
  channelId: string;
  channelTitle: string;
  videoId: string;
  title: string;
  publishedAt: string;
  durationSec: number;
  views: number;
  likes: number;
  comments: number;
  ageDays: number;
  viewsPerDay: number;
  velocity: number;
  hookTag: string;
  url: string;
};

type Pattern = { phrase: string; count: number };

type V2Response = {
  days: number;
  maxVideos: number;
  channels: Array<{
    channelId: string;
    title: string;
    subscribers: number;
    totalViews: number;
    videoCount: number;
  }>;
  channelSummary: ChannelSummary[];
  globalTopByVelocity: Row[];
  globalTopByViewsPerDay: Row[];
  globalPatterns: Pattern[];
  rows: Row[];
};

function secToMinSec(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function exportRowsToCsv(rows: Row[], filename: string) {
  const header = [
    "channelTitle",
    "title",
    "publishedAt",
    "durationSec",
    "views",
    "likes",
    "comments",
    "ageDays",
    "viewsPerDay",
    "velocity",
    "hookTag",
    "url",
  ];

  const lines = [header.join(",")].concat(
    rows.map((r) =>
      header
        .map((k) => `"${String((r as any)[k] ?? "").replaceAll(`"`, `""`)}"`)
        .join(",")
    )
  );

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Page() {
  const [inputsText, setInputsText] = useState(
    "@mangcaureview\n@holyreview2"
  );
  const [days, setDays] = useState(60);
  const [maxVideos, setMaxVideos] = useState(80);

  const [data, setData] = useState<V2Response | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const [selectedChannelId, setSelectedChannelId] = useState<string>("ALL");
  const [sortKey, setSortKey] = useState<"velocity" | "viewsPerDay" | "views">(
    "velocity"
  );
  const [minViewsPerDay, setMinViewsPerDay] = useState<number>(0);

  const inputs = useMemo(() => {
    return inputsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10);
  }, [inputsText]);

  const run = async () => {
    setErr("");
    setLoading(true);
    setData(null);

    try {
      const res = await fetch("/api/analyze-v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputs,
          days,
          maxVideos,
        }),
      });

      const js = await res.json();
      if (!res.ok) throw new Error(js.error || "Request failed");

      setData(js);
      setSelectedChannelId("ALL");
      setSortKey("velocity");
      setMinViewsPerDay(0);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const channelOptions = useMemo(() => {
    if (!data) return [];
    return data.channelSummary.map((c) => ({
      id: c.channelId,
      title: c.channelTitle,
    }));
  }, [data]);

  const filteredRows = useMemo(() => {
    const rows = data?.rows || [];
    return rows
      .filter((r) => (selectedChannelId === "ALL" ? true : r.channelId === selectedChannelId))
      .filter((r) => r.viewsPerDay >= minViewsPerDay);
  }, [data, selectedChannelId, minViewsPerDay]);

  const sortedRows = useMemo(() => {
    const rows = [...filteredRows];
    rows.sort((a, b) => {
      if (sortKey === "velocity") return b.velocity - a.velocity;
      if (sortKey === "viewsPerDay") return b.viewsPerDay - a.viewsPerDay;
      return b.views - a.views;
    });
    return rows;
  }, [filteredRows, sortKey]);

  const topVelocity = useMemo(() => {
    const rows = data?.globalTopByVelocity || [];
    return selectedChannelId === "ALL"
      ? rows
      : rows.filter((r) => r.channelId === selectedChannelId);
  }, [data, selectedChannelId]);

  const topVpd = useMemo(() => {
    const rows = data?.globalTopByViewsPerDay || [];
    return selectedChannelId === "ALL"
      ? rows
      : rows.filter((r) => r.channelId === selectedChannelId);
  }, [data, selectedChannelId]);

  const patterns = useMemo(() => {
    const ps = data?.globalPatterns || [];
    return ps.slice(0, 40);
  }, [data]);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", lineHeight: 1.4 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>YT Competitor Analyzer — v2</h1>
          <p style={{ margin: "6px 0 0 0" }}>
            So sánh nhiều kênh • Top video bùng • Pattern tiêu đề (2–4 từ) • Export CSV
          </p>
        </div>
      </div>

      {/* Controls */}
      <section
        style={{
          marginTop: 16,
          padding: 14,
          border: "1px solid #e6e6e6",
          borderRadius: 12,
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 14 }}>
          <div>
            <label style={{ fontWeight: 600 }}>Danh sách kênh (mỗi dòng 1 kênh)</label>
            <textarea
              value={inputsText}
              onChange={(e) => setInputsText(e.target.value)}
              rows={5}
              placeholder="@holyreview2&#10;https://www.youtube.com/@mangcaureview"
              style={{ width: "100%", marginTop: 8, padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
            />
            <div style={{ fontSize: 12, marginTop: 6, opacity: 0.8 }}>
              Hỗ trợ: URL, @handle, channelId (UC...)
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateRows: "auto auto auto auto", gap: 10 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <div>
                <label style={{ fontWeight: 600 }}>Khoảng thời gian</label>
                <div>
                  <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ padding: 8, borderRadius: 10, border: "1px solid #ddd", marginTop: 6 }}>
                    <option value={30}>30 ngày</option>
                    <option value={60}>60 ngày</option>
                    <option value={90}>90 ngày</option>
                    <option value={180}>180 ngày</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontWeight: 600 }}>Max video / kênh</label>
                <div>
                  <select value={maxVideos} onChange={(e) => setMaxVideos(Number(e.target.value))} style={{ padding: 8, borderRadius: 10, border: "1px solid #ddd", marginTop: 6 }}>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={80}>80</option>
                    <option value={120}>120</option>
                    <option value={200}>200</option>
                  </select>
                </div>
              </div>
            </div>

            <button
              onClick={run}
              disabled={loading || inputs.length === 0}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid #111",
                background: loading ? "#f5f5f5" : "#111",
                color: loading ? "#111" : "#fff",
                cursor: loading ? "not-allowed" : "pointer",
                fontWeight: 700,
              }}
            >
              {loading ? "Đang phân tích..." : "Phân tích v2"}
            </button>

            <div style={{ fontSize: 13, opacity: 0.85 }}>
              Tip: chọn 60–90 ngày để thấy pattern ổn định.
            </div>

            {err ? <div style={{ color: "crimson", fontWeight: 600 }}>{err}</div> : null}
          </div>
        </div>
      </section>
{/* Strategic Summary */}
{data?.channelSummary?.length ? (
  <section style={{ marginTop: 14, padding: 16, border: "1px solid #444", borderRadius: 12 }}>
    <h2 style={{ marginTop: 0 }}>🔥 Kết luận nhanh</h2>

    {(() => {
      const topChannel = data.channelSummary[0];
      const topVideos = (data.globalTopByVelocity || []).slice(0, 3);

      const top20 = (data.globalTopByVelocity || []).slice(0, 20);
      const avgTopDuration =
        top20.length > 0
          ? Math.round(top20.reduce((s, r) => s + (r.durationSec || 0), 0) / top20.length)
          : 0;

      return (
        <div style={{ display: "grid", gap: 8 }}>
          <div>
            🏆 <b>Kênh đang mạnh nhất:</b> {topChannel?.channelTitle || "—"}
          </div>

          <div>
            ⏱ <b>Độ dài đang thắng:</b>{" "}
            {avgTopDuration ? `~ ${Math.floor(avgTopDuration / 60)} phút` : "—"}
          </div>

          <div>
            🎬 <b>3 video đáng học nhất:</b>
            <ul>
              {topVideos.length ? (
                topVideos.map((v) => (
                  <li key={v.videoId}>
                    <a href={v.url} target="_blank" rel="noreferrer">
                      {v.title}
                    </a>{" "}
                    (velocity {v.velocity})
                  </li>
                ))
              ) : (
                <li>—</li>
              )}
            </ul>
          </div>
        </div>
      );
    })()}
  </section>
) : null}


      {/* Filters */}
      {data ? (
        <section style={{ marginTop: 14, padding: 14, border: "1px solid #e6e6e6", borderRadius: 12 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <label style={{ fontWeight: 600 }}>Lọc theo kênh</label>
              <div>
                <select
                  value={selectedChannelId}
                  onChange={(e) => setSelectedChannelId(e.target.value)}
                  style={{ padding: 8, borderRadius: 10, border: "1px solid #ddd", marginTop: 6, minWidth: 260 }}
                >
                  <option value="ALL">Tất cả</option>
                  {channelOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label style={{ fontWeight: 600 }}>Sắp xếp</label>
              <div>
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as any)}
                  style={{ padding: 8, borderRadius: 10, border: "1px solid #ddd", marginTop: 6 }}
                >
                  <option value="velocity">Velocity (khuyên dùng)</option>
                  <option value="viewsPerDay">Views/day</option>
                  <option value="views">Views tổng</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ fontWeight: 600 }}>Min views/day</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                <input
                  type="number"
                  value={minViewsPerDay}
                  onChange={(e) => setMinViewsPerDay(Number(e.target.value || 0))}
                  style={{ padding: 8, borderRadius: 10, border: "1px solid #ddd", width: 140 }}
                />
                <span style={{ opacity: 0.8, fontSize: 12 }}>lọc video bùng</span>
              </div>
            </div>

            <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => exportRowsToCsv(sortedRows, "v2_filtered_rows.csv")}
                style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid #ddd", cursor: "pointer", fontWeight: 700 }}
              >
                Export (filtered)
              </button>
              <button
                onClick={() => exportRowsToCsv(data.rows, "v2_all_rows.csv")}
                style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid #ddd", cursor: "pointer", fontWeight: 700 }}
              >
                Export (all)
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {/* Channel summary */}
      {data ? (
        <section style={{ marginTop: 14 }}>
          <h2 style={{ marginBottom: 8 }}>So sánh kênh (trong {data.days} ngày)</h2>

          <div style={{ overflowX: "auto" }}>
            <table border={1} cellPadding={8} style={{ borderCollapse: "collapse", minWidth: 980 }}>
              <thead>
                <tr>
                  <th>Kênh</th>
                  <th>Video</th>
                  <th>Avg duration</th>
                  <th>Avg views/day</th>
                  <th>Avg velocity</th>
                  <th>Hook mix (top)</th>
                </tr>
              </thead>
              <tbody>
                {data.channelSummary.map((c) => (
                  <tr key={c.channelId}>
                    <td style={{ fontWeight: 700 }}>{c.channelTitle}</td>
                    <td>{c.videosInWindow}</td>
                    <td>{secToMinSec(c.avgDurationSec)}</td>
                    <td>{c.avgViewsPerDay}</td>
                    <td>{c.avgVelocity}</td>
                    <td>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {c.hookMix.slice(0, 6).map((h) => (
                          <span
                            key={h.tag}
                            style={{
                              padding: "4px 8px",
                              border: "1px solid #ddd",
                              borderRadius: 999,
                              fontSize: 12,
                            }}
                          >
                            {h.tag} ({h.count})
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Global patterns */}
      {data ? (
        <section style={{ marginTop: 14 }}>
          <h2 style={{ marginBottom: 8 }}>Pattern tiêu đề (cụm 2–4 từ)</h2>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {patterns.map((p) => (
              <span
                key={p.phrase}
                style={{
                  padding: "6px 10px",
                  border: "1px solid #ddd",
                  borderRadius: 999,
                  fontSize: 13,
                }}
                title={`xuất hiện: ${p.count}`}
              >
                {p.phrase} ({p.count})
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {/* Top lists */}
      {data ? (
        <section style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{ padding: 14, border: "1px solid #e6e6e6", borderRadius: 12 }}>
            <h2 style={{ marginTop: 0 }}>Top bùng theo Velocity</h2>
            <ol style={{ paddingLeft: 18 }}>
              {topVelocity.slice(0, 12).map((v) => (
                <li key={v.videoId} style={{ marginBottom: 8 }}>
                  <a href={v.url} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>
                    {v.title}
                  </a>
                  <div style={{ fontSize: 12, opacity: 0.85 }}>
                    {v.channelTitle} • {v.publishedAt?.slice(0, 10)} • {secToMinSec(v.durationSec)} •{" "}
                    velocity {v.velocity} • views/day {v.viewsPerDay} • views {v.views}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div style={{ padding: 14, border: "1px solid #e6e6e6", borderRadius: 12 }}>
            <h2 style={{ marginTop: 0 }}>Top bùng theo Views/day</h2>
            <ol style={{ paddingLeft: 18 }}>
              {topVpd.slice(0, 12).map((v) => (
                <li key={v.videoId} style={{ marginBottom: 8 }}>
                  <a href={v.url} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>
                    {v.title}
                  </a>
                  <div style={{ fontSize: 12, opacity: 0.85 }}>
                    {v.channelTitle} • {v.publishedAt?.slice(0, 10)} • {secToMinSec(v.durationSec)} •{" "}
                    views/day {v.viewsPerDay} • velocity {v.velocity} • views {v.views}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>
      ) : null}

      {/* Detailed table */}
      {data ? (
        <section style={{ marginTop: 14 }}>
          <h2 style={{ marginBottom: 8 }}>
            Bảng chi tiết ({sortedRows.length} video) — sort: {sortKey}
          </h2>

          <div style={{ overflowX: "auto" }}>
            <table border={1} cellPadding={8} style={{ borderCollapse: "collapse", minWidth: 1200 }}>
              <thead>
                <tr>
                  <th>Kênh</th>
                  <th>Title</th>
                  <th>Published</th>
                  <th>Dur</th>
                  <th>Views</th>
                  <th>Views/day</th>
                  <th>Velocity</th>
                  <th>Likes</th>
                  <th>Comments</th>
                  <th>Hook</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.slice(0, 300).map((r) => (
                  <tr key={`${r.channelId}-${r.videoId}`}>
                    <td style={{ fontWeight: 700 }}>{r.channelTitle}</td>
                    <td>
                      <a href={r.url} target="_blank" rel="noreferrer">
                        {r.title}
                      </a>
                    </td>
                    <td>{r.publishedAt?.slice(0, 10)}</td>
                    <td>{secToMinSec(r.durationSec)}</td>
                    <td>{r.views}</td>
                    <td>{r.viewsPerDay}</td>
                    <td>{r.velocity}</td>
                    <td>{r.likes}</td>
                    <td>{r.comments}</td>
                    <td>{r.hookTag}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
            Hiện tối đa 300 dòng để UI mượt. Export CSV sẽ lấy đầy đủ.
          </div>
        </section>
      ) : null}
    </main>
  );
}
