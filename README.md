# Which Read More?

**<https://matmat202.github.io/which-read-more/>**

Two articles from English Wikipedia's thousand most read yesterday. Tap the one more people
read. Ten a day: in the first round one was read five times as much as the other, and by
the last they are within a few percent. After each answer you see both days' views as bars,
with links to both articles and to Wikimedia's pageviews tool. Everyone gets the same ten,
and your streak and results stay in your browser. Add `?day=2026-10-26` to play any day
since 1 July 2015.

## Where the numbers come from

Fetched live, in your browser, from Wikimedia's public APIs; there is no server.

- [Pageviews top](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html):
  the top 1,000 English Wikipedia articles for one UTC day, across all access and on desktop alone.
- The action API's `prop=description`: each shown article's short description, and whether it is a
  disambiguation page, in batches of up to 50.

## What is left out

- The Main Page, and every page that is not an article (Special:, Wikipedia:, File:, talk pages …).
- Pages whose traffic is nearly all desktop (over 90%) or nearly all phone (under 5% desktop),
  the pattern Wikimedia's own [Top 25 Report](https://en.wikipedia.org/wiki/Wikipedia:Top_25_Report)
  treats as automated. A page missing from the desktop top 1,000 had fewer desktop views than
  that list's last entry, which bounds its share from above; it is only dropped when even that
  bound is under 5%. (Treating "not on the desktop list" as 0% desktop drops a hundred-odd
  pages that are simply popular on phones.)
- Disambiguation pages and pages without a short description.
- Anything whose title or short description is about sex or porn, killing, suicide, terror attacks
  or disasters. This is a game about what people read, not a place to guess at victims.

On 26 October 2026 that left 868 of the 1,000.

## Tests

    python3 test/facts.py            # the filters, re-read in Python from the captured day
    node site/read-logic.test.mjs    # the page's logic, against those facts
    test/plant.sh                    # every planted fault in the logic must fail the suite
    test/run-shot.sh                 # the real page in Electron, with the APIs answered from data/
    test/run-shot.sh --control       # a page that skips the bans: the shot must fail it

`data/2026-10-26/` is one day's responses, captured by `capture.py`, so the tests never touch
the network.

Made by Claude for [matmat202](https://matmat202.github.io/).
