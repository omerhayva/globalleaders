import { useEffect, useRef, useState } from 'react';
import { useStore } from '../useStore.jsx';
import { api, num, FLAG } from '../api.js';
import { useRoll } from '../hooks.js';

function FlagImg({ cc, size = 20 }) {
  if (!cc) return null;

  return (
    <img
      className="flag"
      src={`/flags/w${size <= 40 ? 40 : 160}/${String(cc).toLowerCase()}.png`}
      alt={`${cc} flag`}
      width={size}
      height={Math.round(size * 0.7)}
      loading="lazy"
      onError={e => {
        try {
          e.currentTarget.replaceWith(
            document.createTextNode(FLAG(cc))
          );
        } catch {}
      }}
    />
  );
}

function Movement({ m }) {
  if (m > 0) {
    return (
      <span className="mv up" aria-label={`Up ${m} places`}>
        ↑ {m}
      </span>
    );
  }

  if (m < 0) {
    return (
      <span className="mv down" aria-label={`Down ${-m} places`}>
        ↓ {Math.abs(m)}
      </span>
    );
  }

  return (
    <span className="mv same" aria-label="No change">
      — 0
    </span>
  );
}

function Sparkline({ values, w = 100, h = 32 }) {
  if (!values || !values.length) return null;

  const max = Math.max(...values, 1);

  const pts = values
    .map((v, i) => {
      const x =
        i / Math.max(1, values.length - 1) * w;

      const y =
        h -
        3 -
        (v / max) * (h - 8);

      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      className="lb-sparkline"
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      aria-label="7 day vote trend"
    >
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RankBadge({ rank }) {
  const medal =
    rank === 1 ? 'gold' :
    rank === 2 ? 'silver' :
    rank === 3 ? 'bronze' :
    '';

  return (
    <div className={`new-rank ${medal}`}>
      {rank === 1 && (
        <span className="new-crown">♛</span>
      )}
      <span>{rank}</span>
    </div>
  );
}

function Row({
  l,
  i,
  voted,
  flash,
  rankCls,
  barPct
}) {
  const shown = useRoll(l.total_votes);

  const isTop3 = l.rank <= 3;

  return (
    <article
      className={[
        'new-lb-row',
        isTop3 ? `top-${l.rank}` : '',
        flash ? 'flash' : '',
        rankCls || ''
      ].filter(Boolean).join(' ')}
      data-slug={l.slug}
      data-rank={l.rank}
      style={{ '--i': i }}
    >
      <div className="new-rank-column">
        <RankBadge rank={l.rank} />
        <Movement m={l.movement} />
      </div>

      <a
        className="new-portrait-wrap"
        href={`/leader/${l.slug}`}
        aria-label={`View ${l.name}`}
      >
        {l.portrait ? (
          <img
            className="new-portrait"
            src={l.portrait}
            alt={`Portrait of ${l.name}`}
            width="72"
            height="72"
            loading="lazy"
          />
        ) : (
          <img
            className="new-portrait"
            src={`/portrait/${l.slug}.svg`}
            alt={`Portrait of ${l.name}`}
            width="72"
            height="72"
            loading="lazy"
          />
        )}

        {l.rank === 1 && (
          <span className="champion-ring">★</span>
        )}
      </a>

      <div className="new-lb-info">
        <div className="new-lb-topline">
          <span className="new-lb-rank-label">
            {l.rank === 1
              ? 'WORLD #1'
              : `RANK #${l.rank}`}
          </span>

          {l.verified ? (
            <span
              className="new-verified"
              title="Verified profile"
            >
              ✓
            </span>
          ) : null}

          {l.community ? (
            <span className="new-community">
              COMMUNITY
            </span>
          ) : null}

          {voted && (
            <span className="new-voted">
              ✓ YOUR VOTE
            </span>
          )}
        </div>

        <a
          className="new-lb-name"
          href={`/leader/${l.slug}`}
        >
          {l.name}
        </a>

        <div className="new-lb-country">
          <FlagImg
            cc={l.country_code}
            size={24}
          />

          <span>
            {l.countryName || l.country_code}
          </span>

          {l.title && (
            <>
              <span className="country-dot">•</span>
              <span className="leader-title">
                {l.title}
              </span>
            </>
          )}
        </div>

        <div className="new-power-track">
          <div
            className="new-power-fill"
            style={{ '--w': `${barPct}%` }}
          />
        </div>
      </div>

      <div className="new-trend">
        <Sparkline values={l.spark} />

        <span className="trend-label">
          7 DAY TREND
        </span>
      </div>

      <div className="new-vote-stat">
        <span className="new-vote-number">
          {num(shown)}
        </span>

        <span className="new-vote-label">
          VOTES
        </span>

        <span className="new-vote-percent">
          {l.pct}%
        </span>
      </div>

      <div className="new-actions">
        <button
          className="new-vote-button"
          data-vote={l.slug}
          aria-label={`Vote for ${l.name}`}
        >
          <span>VOTE</span>
          <b>+</b>
        </button>

        <button
          className="new-share-button"
          data-share={l.slug}
          aria-label={`Share ${l.name}`}
        >
          ↗
          <span>SHARE</span>
        </button>
      </div>

      <div className="new-rank-line">
        <i style={{ '--w': `${barPct}%` }} />
      </div>
    </article>
  );
}

export function Leaderboard({
  initialRows,
  qs
}) {
  const st = useStore();

  const [rows, setRows] =
    useState(initialRows);

  const [flashSlug, setFlashSlug] =
    useState(null);

  const [rankCls, setRankCls] =
    useState({});

  const rowsRef =
    useRef(initialRows);

  useEffect(() => {
    const onSse = e => {
      const { event, data } =
        e.detail || {};

      if (
        event ===
        'leader_vote_count_updated'
      ) {
        setRows(prev =>
          prev &&
          prev.map(r =>
            r.slug === data.slug
              ? {
                  ...r,
                  totalVotes:
                    data.totalVotes,
                  total_votes:
                    data.totalVotes,
                  rank:
                    data.rank || r.rank
                }
              : r
          )
        );

        setFlashSlug(data.slug);

        setTimeout(
          () => setFlashSlug(null),
          1400
        );
      }

      if (
        event ===
        'leader_rank_changed'
      ) {
        api(
          `/api/leaderboard?${qs}`
        )
          .then(r => {
            const prev =
              rowsRef.current || [];

            const cls = {};

            r.rows.forEach(nr => {
              const old =
                prev.find(
                  p =>
                    p.slug === nr.slug
                );

              if (
                old &&
                old.rank !== nr.rank
              ) {
                cls[nr.slug] =
                  nr.rank < old.rank
                    ? 'rank-up'
                    : 'rank-down';
              }
            });

            rowsRef.current =
              r.rows;

            setRows(r.rows);
            setRankCls(cls);

            setTimeout(
              () => setRankCls({}),
              1100
            );
          })
          .catch(() => {});
      }
    };

    document.addEventListener(
      'gl:sse',
      onSse
    );

    return () => {
      document.removeEventListener(
        'gl:sse',
        onSse
      );
    };
  }, [qs]);

  const voted = new Set(
    (st.myVotes || []).map(
      v => v.slug
    )
  );

  const maxVotes = Math.max(
    ...rows.map(
      r => r.total_votes || 0
    ),
    1
  );

  return (
    <div className="new-leaderboard">
      {rows.map((l, i) => {
        const barPct =
          Math.max(
            5,
            Math.round(
              ((l.total_votes || 0) /
                maxVotes) *
                100
            )
          );

        return (
          <Row
            key={l.slug}
            l={l}
            i={i}
            voted={voted.has(l.slug)}
            barPct={barPct}
            flash={
              flashSlug === l.slug
            }
            rankCls={
              rankCls[l.slug]
            }
          />
        );
      })}
    </div>
  );
}