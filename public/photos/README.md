# Landing photography

These are **real photographs**, not generated imagery. They are used by the
"Real work, real schedules" section of the public landing page (`app/page.tsx`).

Each file was centre-cropped to 4:3 and re-encoded as a progressive JPEG at quality 82 with
Pillow. The files are deliberately small (92–208 KB): the repo serves them with `next/image`
`unoptimized`, because production runs without `sharp`, so the source file is what the browser
downloads.

| File | Subject | Source | Licence |
| --- | --- | --- | --- |
| `worker-at-desktop.jpg` | Man working at a desktop monitor and laptop | [Unsplash g4c1wNljbBI](https://unsplash.com/photos/a-man-sitting-at-a-desk-working-on-a-computer-g4c1wNljbBI) | Unsplash License |
| `worker-at-laptop.jpg` | Smiling man working on a laptop | Unsplash search result, *african man laptop working office* (photo page not retained) | Unsplash License |
| `team-at-laptop.jpg` | Two women collaborating over a laptop | [Unsplash yTFJkulaUyI](https://unsplash.com/photos/two-women-collaborate-at-a-desk-in-a-modern-office-yTFJkulaUyI) | Unsplash License |

`worker-at-desktop.jpg` is also the landing hero backdrop. It is rendered at low opacity behind a
soft fade mask on the light hero, so the grid, headline and dashboard preview stay the focus. It is
never blurred.

The [Unsplash License](https://unsplash.com/license) permits free commercial use and does not
require attribution. The sources and licence are recorded here; the landing page itself carries no
photography credit line.

## Replacing a photo

Keep the same aspect ratio and roughly the same file size, update the `WORK_PHOTOS` entry in
`app/page.tsx` (including `width`, `height` and `alt`), and record the source in the table above.
Do not hotlink stock-photo previews: they are often watermarked and the URLs can expire.
