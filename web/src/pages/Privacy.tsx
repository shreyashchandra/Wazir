// The extension's privacy policy is carried over verbatim from the previous
// landing page (the Chrome Web Store listing links to it); the website section is new.
export function PrivacyPolicy() {
  return (
    <article className="prose">
      <h2>Privacy Policy for Wazir</h2>
      <p><strong>Effective date:</strong> March 17, 2026</p>

      <h3>Wazir website</h3>
      <p>
        The Wazir website runs Stockfish analysis inside your browser. It requests public data (profiles, stats and game
        archives) directly from the chess.com Published-Data API for the usernames you enter. Fetched games and finished
        analyses are cached in your browser's local storage (IndexedDB) to make repeat visits fast; you can clear them at
        any time by clearing site data. The website has no accounts, does not send your games or analyses to a Wazir
        server, does not sell data, and does not use data for advertising.
      </p>

      <h3>Wazir Chrome extension</h3>
      <p>Wazir is a Chrome extension that helps users analyze finished chess.com games using local Stockfish analysis.</p>
      <h3>1. Information Wazir may access</h3>
      <p>On supported chess.com game pages, Wazir may access limited website content required for its core functionality, including:</p>
      <ul>
        <li>Game ID</li>
        <li>Game type or page context</li>
        <li>Chess.com usernames visible on the game page</li>
        <li>PGN-related metadata needed to identify the selected game</li>
        <li>PGN text provided by the user or retrieved for analysis</li>
      </ul>
      <h3>2. How this information is used</h3>
      <p>Wazir uses this information only to:</p>
      <ul>
        <li>Identify the currently open finished chess.com game</li>
        <li>Retrieve the correct PGN for that game</li>
        <li>Run game analysis inside the extension</li>
        <li>Display move classifications, accuracy, ACPL, charts, and board review</li>
      </ul>
      <h3>3. Local analysis</h3>
      <p>
        Wazir runs Stockfish analysis locally inside the extension using packaged extension resources. Wazir does not
        download or execute remote JavaScript or remote WebAssembly as part of its analysis functionality.
      </p>
      <h3>4. Data sharing</h3>
      <p>
        Wazir does not sell personal data. Wazir does not use user data for advertising. Wazir does not use or transfer
        user data for creditworthiness, lending decisions, or unrelated profiling.
      </p>
      <p>
        If PGN retrieval is performed through a Wazir-operated API, Wazir may send the minimum information required to
        locate the selected game PGN, such as username, game ID, and archive lookup context. This is used only for the
        extension’s core functionality.
      </p>
      <h3>5. Data storage</h3>
      <p>
        Wazir does not permanently store analyzed game data on external servers unless explicitly stated otherwise.
        Temporary processing may occur as needed to return PGN data for the selected game.
      </p>
      <h3>6. User choices</h3>
      <p>
        Users choose when to open the extension, fetch a PGN, and run an analysis. Wazir is intended for user-initiated
        review of finished chess games.
      </p>
      <h3>7. Third-party services</h3>
      <p>Wazir may communicate with:</p>
      <ul>
        <li>chess.com pages selected by the user</li>
        <li>public or Wazir-operated PGN retrieval endpoints</li>
      </ul>
      <h3>8. Children’s privacy</h3>
      <p>Wazir is not directed to children under 13 and does not knowingly collect personal information from children.</p>
      <h3>9. Changes to this policy</h3>
      <p>This privacy policy may be updated from time to time. Any changes will be reflected on this page.</p>
      <h3>10. Contact</h3>
      <p>
        For support or privacy questions, contact: <a href="mailto:shreyash.chandra123@gmail.com">shreyash.chandra123@gmail.com</a>
      </p>
      <h3>11. Non-affiliation notice</h3>
      <p>Wazir is an independent project and is not affiliated with, endorsed by, or sponsored by Chess.com.</p>
    </article>
  );
}

export function PrivacyPage() {
  return (
    <div className="container" style={{ padding: "32px 0" }}>
      <PrivacyPolicy />
    </div>
  );
}
