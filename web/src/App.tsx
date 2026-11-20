import { lazy, Suspense } from "react";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { Layout, Spinner, UserSearch } from "./components/Layout";
import { Home } from "./pages/Home";
import { PrivacyPage } from "./pages/Privacy";

const Review = lazy(() => import("./pages/Review").then((m) => ({ default: m.ReviewStart })));
const ReviewArchive = lazy(() => import("./pages/Review").then((m) => ({ default: m.ReviewFromArchive })));
const ReviewPgn = lazy(() => import("./pages/Review").then((m) => ({ default: m.ReviewFromPgn })));
const Player = lazy(() => import("./pages/Player").then((m) => ({ default: m.PlayerPage })));
const WrappedStart = lazy(() => import("./pages/Wrapped").then((m) => ({ default: m.WrappedStart })));
const WrappedStory = lazy(() => import("./pages/Wrapped").then((m) => ({ default: m.WrappedStory })));

function StatsStart() {
  return (
    <div className="container" style={{ padding: "48px 0", maxWidth: 640 }}>
      <span className="eyebrow">Stats &amp; progress</span>
      <h1>How are you really doing?</h1>
      <p className="muted">
        Rating history, monthly trends, openings, results by color and opponent strength, when you play best, and every
        game with one-click review.
      </p>
      <UserSearch big autoFocus />
    </div>
  );
}

function NotFound() {
  return (
    <div className="container center-msg">
      <h2>Page not found</h2>
      <Link to="/">Back home</Link>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Suspense fallback={<Spinner />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/review" element={<Review />} />
            <Route path="/review/pgn" element={<ReviewPgn />} />
            <Route path="/review/:username/:gameId" element={<ReviewArchive />} />
            <Route path="/stats" element={<StatsStart />} />
            <Route path="/player/:username" element={<Player />} />
            <Route path="/wrapped" element={<WrappedStart />} />
            <Route path="/wrapped/:username/:period" element={<WrappedStory />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </Layout>
    </BrowserRouter>
  );
}
