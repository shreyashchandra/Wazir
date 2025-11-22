import { Hono } from "hono";
import { wrapToWidth } from "./utils/wrapToWidth";

const app = new Hono();

app.get("/", (c) => c.json({ message: "Server Running Fine" }));

app.get("/pgn", async (c) => {
  try {
    const username = c.req.query("username");
    const month = c.req.query("month");
    const year = c.req.query("year");

    if (!username || !month || !year) {
      return c.json({ message: "username, month, and year are required" }, 400);
    }

    const mm = month.padStart(2, "0");
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
        return c.json(
          { message: "No games found for this username/month/year." },
          404
        );
      }
      return c.json(
        { message: "Chess.com API error", status: resp.status },
        resp.status as 400 | 401 | 403 | 404 | 500
      );
    }

    const pgnString = await resp.text();

    // Split into individual games
    const games = pgnString
      .split(/\n(?=\[Event\s+")|(?=^\[Event\s+")/gm)
      .filter((g) => g.trim().startsWith('[Event "'));

    const formattedGames = games.map((rawPGN) => {
      const normalized = rawPGN.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n");
      const splitIdx = normalized.indexOf("\n\n");
      const headerPart =
        splitIdx >= 0 ? normalized.slice(0, splitIdx) : normalized;
      const movesPart = splitIdx >= 0 ? normalized.slice(splitIdx + 2) : "";

      // Parse tags
      const tags: Record<string, string> = {};
      const tagRe = /\[(\w+)\s+"([^"]*)"\]/g;
      let m;
      while ((m = tagRe.exec(headerPart)) !== null) tags[m[1]] = m[2];

      const event = tags.Event || "Live Chess";
      const site = tags.Site || "Chess.com";
      const date = tags.Date || tags.UTCDate || "";
      const round = "?";
      const white = tags.White || "";
      const black = tags.Black || "";
      const result = tags.Result || "*";
      const timeControl = tags.TimeControl || "";
      const whiteElo = tags.WhiteElo || "";
      const blackElo = tags.BlackElo || "";
      const termination = tags.Termination || "";
      const eco = tags.ECO || "";
      const endTimeRaw = tags.EndTime || tags.UTCTime || "";
      const linkRaw = tags.Link || "";

      // Extract game ID and enforce ?move=0 link format
      let link = linkRaw;
      let gameID;
      const linkMatch = linkRaw.match(
        /^https:\/\/www\.chess\.com\/game\/live\/(\d+)/
      );
      if (linkMatch) {
        gameID = linkMatch[1];
        if (!link.includes("move=0")) {
          link = link.includes("?") ? `${link}&move=0` : `${link}?move=0`;
        }
      } else {
        gameID =
          (headerPart.match(/https:\/\/www\.chess\.com\/game\/live\/(\d+)/) ||
            [])[1] || Math.random().toString(36).slice(2, 10);
        link = `https://www.chess.com/game/live/${gameID}?move=0`;
      }

      // Fix end time formatting
      let endTime = endTimeRaw;
      if (endTime && !/\bGMT[+-]\d{4}\b/.test(endTime)) {
        endTime = `${endTime} GMT+0000`;
      }

      // Clean moves
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
        `[Event "${event}"]`,
        `[Site "${site}"]`,
        `[Date "${date}"]`,
        `[Round "${round}"]`,
        `[White "${white}"]`,
        `[Black "${black}"]`,
        `[Result "${result}"]`,
        `[TimeControl "${timeControl}"]`,
        `[WhiteElo "${whiteElo}"]`,
        `[BlackElo "${blackElo}"]`,
        `[Termination "${termination}"]`,
        `[ECO "${eco}"]`,
      ];
      if (endTime) headerLines.push(`[EndTime "${endTime}"]`);
      headerLines.push(`[Link "${link}"]`);

      return {
        gameID,
        PGN: `${headerLines.join("\n")}\n\n${moves}`,
      };
    });

    return c.json(formattedGames);
  } catch (err) {
    return c.json({ message: "Error processing PGN" }, 500);
  }
});

export default app;
