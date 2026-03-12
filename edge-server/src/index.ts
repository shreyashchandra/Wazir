import { Hono } from "hono";
import { wrapToWidth } from "./utils/wrapToWidth";

const app = new Hono();

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function escapePgnValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function deriveOpeningFromEcoUrl(ecoUrl: string): string {
  if (!ecoUrl) return "";

  const match = ecoUrl.match(/\/openings\/([^?#]+)/i);
  if (!match?.[1]) return "";

  try {
    return decodeURIComponent(match[1]).replace(/-/g, " ").trim();
  } catch {
    return match[1].replace(/-/g, " ").trim();
  }
}

function normalizeChessComLink(
  linkRaw: string,
  headerPart: string,
): {
  gameID: string;
  gameKind: "live" | "daily";
  link: string;
} {
  const directMatch = linkRaw.match(
    /^https:\/\/www\.chess\.com\/game\/(live|daily)\/(\d+)/i,
  );

  const fallbackMatch = headerPart.match(
    /https:\/\/www\.chess\.com\/game\/(live|daily)\/(\d+)/i,
  );

  const gameKind = (
    directMatch?.[1] ||
    fallbackMatch?.[1] ||
    "live"
  ).toLowerCase() as "live" | "daily";

  const gameID =
    directMatch?.[2] ||
    fallbackMatch?.[2] ||
    Math.random().toString(36).slice(2, 10);

  let link = linkRaw || `https://www.chess.com/game/${gameKind}/${gameID}`;

  if (!/move=0\b/.test(link)) {
    link = link.includes("?") ? `${link}&move=0` : `${link}?move=0`;
  }

  return { gameID, gameKind, link };
}

app.get("/", (c) => c.json({ message: "Server Running Fine" }));

app.get("/pgn", async (c) => {
  try {
    const username = c.req.query("username")?.trim();
    const month = c.req.query("month")?.trim();
    const year = c.req.query("year")?.trim();

    if (!username || !month || !year) {
      return jsonResponse(
        { message: "username, month, and year are required" },
        400,
      );
    }

    if (!/^\d{4}$/.test(year)) {
      return jsonResponse({ message: "year must be a 4-digit number" }, 400);
    }

    if (!/^\d{1,2}$/.test(month)) {
      return jsonResponse({ message: "month must be between 1 and 12" }, 400);
    }

    const monthNum = Number(month);
    if (monthNum < 1 || monthNum > 12) {
      return jsonResponse({ message: "month must be between 1 and 12" }, 400);
    }

    const mm = String(monthNum).padStart(2, "0");
    const url = `https://api.chess.com/pub/player/${username}/games/${year}/${mm}/pgn`;

    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; PGN-API/1.0; +https://github.com/chess-pgn-api)",
        Accept: "text/plain",
      },
    });

    if (!resp.ok) {
      if (resp.status === 404) {
        return jsonResponse(
          { message: "No games found for this username/month/year." },
          404,
        );
      }

      return jsonResponse(
        { message: "Chess.com API error", status: resp.status },
        resp.status,
      );
    }

    const pgnString = await resp.text();

    const games = pgnString
      .split(/\n(?=\[Event\s+")|(?=^\[Event\s+")/gm)
      .filter((g) => g.trim().startsWith('[Event "'));

    const formattedGames = games.map((rawPGN) => {
      const normalized = rawPGN.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n");

      const splitIdx = normalized.indexOf("\n\n");
      const headerPart =
        splitIdx >= 0 ? normalized.slice(0, splitIdx) : normalized;
      const movesPart = splitIdx >= 0 ? normalized.slice(splitIdx + 2) : "";

      const tags: Record<string, string> = {};
      const tagRe = /\[(\w+)\s+"([^"]*)"\]/g;
      let match: RegExpExecArray | null;

      while ((match = tagRe.exec(headerPart)) !== null) {
        tags[match[1]] = match[2];
      }

      const event = tags.Event || "Live Chess";
      const site = tags.Site || "Chess.com";
      const date = tags.Date || tags.UTCDate || "";
      const round = tags.Round || "?";
      const white = tags.White || "";
      const black = tags.Black || "";
      const result = tags.Result || "*";
      const timeControl = tags.TimeControl || "";
      const whiteElo = tags.WhiteElo || "";
      const blackElo = tags.BlackElo || "";
      const termination = tags.Termination || "";
      const eco = tags.ECO || "";
      const ecoUrl = tags.ECOUrl || "";
      const opening = tags.Opening || deriveOpeningFromEcoUrl(ecoUrl);
      const variation = tags.Variation || "";
      const endTimeRaw = tags.EndTime || tags.UTCTime || "";
      const linkRaw = tags.Link || "";

      const { gameID, gameKind, link } = normalizeChessComLink(
        linkRaw,
        headerPart,
      );

      let endTime = endTimeRaw;
      if (endTime && !/\bGMT[+-]\d{4}\b/.test(endTime)) {
        endTime = `${endTime} GMT+0000`;
      }

      let moves = movesPart
        .replace(/\{\[%[^}]*\]\}/g, "")
        .replace(/\{%\s*[^}]*\}/g, "")
        .replace(/\{[^}]*\}/g, "")
        .replace(/\$\d+/g, "")
        .replace(/[ \t]+/g, " ")
        .replace(/\n+/g, " ")
        .trim();

      if (result && result !== "*") {
        moves = moves.replace(/\s*(1-0|0-1|1\/2-1\/2|\*)\s*$/i, "").trim();
        moves = `${moves} ${result}`.trim();
      }

      moves = wrapToWidth(moves, 80);

      const headerLines = [
        `[Event "${escapePgnValue(event)}"]`,
        `[Site "${escapePgnValue(site)}"]`,
        `[Date "${escapePgnValue(date)}"]`,
        `[Round "${escapePgnValue(round)}"]`,
        `[White "${escapePgnValue(white)}"]`,
        `[Black "${escapePgnValue(black)}"]`,
        `[Result "${escapePgnValue(result)}"]`,
        `[TimeControl "${escapePgnValue(timeControl)}"]`,
        `[WhiteElo "${escapePgnValue(whiteElo)}"]`,
        `[BlackElo "${escapePgnValue(blackElo)}"]`,
        `[Termination "${escapePgnValue(termination)}"]`,
        `[ECO "${escapePgnValue(eco)}"]`,
      ];

      if (ecoUrl) {
        headerLines.push(`[ECOUrl "${escapePgnValue(ecoUrl)}"]`);
      }

      if (opening) {
        headerLines.push(`[Opening "${escapePgnValue(opening)}"]`);
      }

      if (variation) {
        headerLines.push(`[Variation "${escapePgnValue(variation)}"]`);
      }

      if (endTime) {
        headerLines.push(`[EndTime "${escapePgnValue(endTime)}"]`);
      }

      headerLines.push(`[Link "${escapePgnValue(link)}"]`);

      return {
        gameID,
        gameKind,
        PGN: `${headerLines.join("\n")}\n\n${moves}`,
      };
    });

    return c.json(formattedGames);
  } catch (err) {
    console.error("Error processing PGN:", err);
    return jsonResponse({ message: "Error processing PGN" }, 500);
  }
});

export default app;
