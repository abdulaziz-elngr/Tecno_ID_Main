# WhatsApp

TecnoID uses **plain WhatsApp click-to-chat links only** (`https://wa.me/<number>`).
There is no WhatsApp Business / Meta Cloud API, no message queue, no worker and no
cron. Nothing is ever sent automatically.

## How it works

1. Staff click a **WhatsApp** button (session absent/late rosters, Unpaid Students).
2. The parent's `whatsappNumber` (falling back to `phone`) is normalized to
   international digits by `src/lib/wa-link.ts`:

   | Stored            | Link                              |
   | ----------------- | --------------------------------- |
   | `01012345678`     | `https://wa.me/201012345678`      |
   | `+201012345678`   | `https://wa.me/201012345678`      |
   | `00201012345678`  | `https://wa.me/201012345678`      |

3. A message is pre-filled with the `text` parameter, rendered from the editable
   templates under Communication -> Templates (`/api/whatsapp/templates`).
4. WhatsApp opens; the staff member presses send themselves.

Invalid numbers show an alert instead of opening a broken link.

## Configuration

None. No WhatsApp environment variables are used.
