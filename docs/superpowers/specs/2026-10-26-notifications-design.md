# Notifications page

A bell at the top right of the feed, left of the avatar, opens `/notifications`. A dot on the
bell means something new since the page was last opened.

## Constraints

- Spark plan, no Cloud Functions: nothing writes notifications for other people. Every item is
  derived on the device from data that already exists, so none can be forged.
- Reads go through the `cached()` session cache in `lib/data.ts`.

## Items (newest first, about 30 per kind)

| Kind | Source | Time | Opens |
|---|---|---|---|
| `follow`: @x followed you | `follows` where `followeeId == me`, `createdAt` desc | `createdAt` | `/u/x` |
| `beaten`: @x beat your 1:23.456 on Route | your posts (best per route, newest 20 routes); per route, posts with `totalMs <` your best, not yours, newer than your best | post `createdAt` | `/lap/:id` |
| `decided`: your creator/admin request was approved / rejected | your `creatorRequests` / `adminRequests` doc, status not pending | `decidedAt` | `/settings` |
| `request`: @x asked to become a creator / an admin | pending `creatorRequests` (admins), pending `adminRequests` (owner) | `createdAt` | `/admin` |

Only posted laps count for `beaten`: private runs aren't on any leaderboard.

## Unread

`notifSeenAt` on the profile. Opening the page sets it to `serverTimestamp()`. The bell shows a
dot if any item is newer. Rules: the owner may change `notifSeenAt`, only to `request.time`.

## Changes

- `firestore.rules`, `tests/rules.test.ts`: the `notifSeenAt` update.
- `firestore.indexes.json`: `follows` (`followeeId` asc, `createdAt` desc).
- `lib/types.ts`: `Notification`, `Profile.notifSeenAt`. `lib/data.ts`: `notifications()`, `markNotificationsSeen()`.
- `screens/Notifications.tsx`, route in `App.tsx`, bell in `screens/Feed.tsx`.

## Not included

Push notifications, dismissing single items.
