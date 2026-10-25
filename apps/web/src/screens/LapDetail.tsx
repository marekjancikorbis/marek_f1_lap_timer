import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LapView } from '../components/LapView';
import { Empty, errorMessage, Loading, ScreenHead, useToast } from '../components/ui';
import { getPost, getRoute, getRun, routePosts, runsForRoute, unpostLap, updatePostText } from '../lib/data';
import { resolveLap, runToLap, type ResolvedLap } from '../lib/laps';
import { useMe } from '../lib/session';
import type { Post, Route } from '../lib/types';

export default function LapDetail() {
  const { postId = '' } = useParams();
  const { profile } = useMe();
  const toast = useToast();
  const nav = useNavigate();
  const [post, setPost] = useState<Post | null | undefined>(undefined);
  const [route, setRoute] = useState<Route | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [driven, setDriven] = useState(false);
  const [against, setAgainst] = useState<ResolvedLap | null>(null);
  // Listed runs come without their profile; the graphs fetch it when first opened.
  const [opened, setOpened] = useState(false);
  const againstRun = opened && against?.ref.startsWith('run:') ? against.ref.slice(4) : null;
  useEffect(() => {
    if (againstRun) getRun(profile.id, againstRun).then((r) => r && setAgainst((a) => a && { ...a, profile: r.profile ?? null })).catch(() => undefined);
  }, [againstRun, profile.id]);

  useEffect(() => {
    (async () => {
      const p = await getPost(postId);
      setPost(p);
      if (!p) return;
      const [r, all, mine] = await Promise.all([getRoute(p.routeId), routePosts(p.routeId).catch(() => []), runsForRoute(profile.id, p.routeId).catch(() => [])]);
      setRoute(r);
      setPosts(all);
      setDriven(mine.some((x) => x.valid));
      // Your own post: the lap you raced, else your best before it. Someone else's: your best, else the route record.
      const valid = mine.filter((x) => x.valid && x.id !== p.id && x.splitTimesMs.length === p.splitTimesMs.length);
      if (p.userId === profile.id) {
        const run = await getRun(profile.id, p.id).catch(() => null);
        const raced = run?.referenceRef ? await resolveLap(run.referenceRef, profile.id, p.routeId).catch(() => null) : null;
        const prev = valid.filter((x) => x.startedAt < p.startedAt).sort((a, b) => a.totalMs - b.totalMs)[0];
        setAgainst(raced ?? (prev ? runToLap(prev, 'your previous best') : null));
      } else {
        const best = [...valid].sort((a, b) => a.totalMs - b.totalMs)[0];
        setAgainst(best ? runToLap(best, 'your best') : await resolveLap('record', profile.id, p.routeId).catch(() => null));
      }
    })().catch((e) => {
      toast(errorMessage(e), 'error');
      setPost(null);
    });
  }, [postId, profile.id, toast]);

  async function editCaption() {
    if (!post) return;
    const caption = prompt('About this lap', post.caption ?? '');
    if (caption === null) return;
    try {
      await updatePostText(post.id, caption, post.car);
      setPost({ ...post, caption: caption.trim() || null });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function remove() {
    if (!post || !confirm('Remove this post? The lap stays in your history.')) return;
    try {
      await unpostLap(profile.id, post.id);
      toast('Post removed');
      nav(-1);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  if (post === undefined) return <Loading />;
  if (!post)
    return (
      <main className="screen">
        <ScreenHead back />
        <Empty title="Lap not available">The post was removed or its route is hidden.</Empty>
      </main>
    );

  const mine = post.userId === profile.id;

  return (
    <main className="screen">
      <ScreenHead back title="Lap" />
      <LapView
        lap={post}
        colours={post.sectorColours}
        route={route}
        posts={posts}
        reference={against}
        onOpen={() => setOpened(true)}
        badges={post.isPB && <span className="badge ink">PB when posted</span>}
        caption={
          (post.caption || post.car) && (
            <p className="lap-hero-caption">
              {post.caption} {post.car && <span className="mute">· {post.car}</span>}
            </p>
          )
        }
        actions={
          <>
            <Link className="btn primary lg block" style={{ marginTop: 16 }} to={`/drive/${post.routeId}?ref=post:${post.id}`}>
              Race against this
            </Link>
            <div className="row" style={{ marginTop: 8 }}>
              {driven && (
                <Link className="btn grow" to={`/compare/${post.routeId}?a=best&b=post:${post.id}`}>
                  Compare with my best
                </Link>
              )}
              <Link className="btn grow" to={`/compare/${post.routeId}?a=post:${post.id}&b=record`}>
                Compare with…
              </Link>
            </div>
          </>
        }
      >
        {mine && (
          <div className="row" style={{ marginTop: 24 }}>
            <button className="btn grow" onClick={editCaption}>
              Edit text
            </button>
            <button className="btn danger grow" onClick={remove}>
              Remove post
            </button>
          </div>
        )}
      </LapView>
    </main>
  );
}
