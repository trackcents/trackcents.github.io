# Brand logos — attribution & trademark notice

This app shows merchant/service logos next to categories so a user can recognize
where their money went (e.g. a Netflix subscription, a Swiggy order, an Uber
ride). How those logos are produced:

## Official marks — Simple Icons (CC0-1.0)

The real official marks (`kind: 'mark'` in `src/lib/app/brand-logos.ts`) are
sourced from **[Simple Icons](https://simpleicons.org/)**, released under
**CC0-1.0** (public domain). They are generated into `brand-logos.ts` by
`scripts/gen-brand-logos.mjs` and rendered in each brand's official colour.

## Lettermark tiles — our own approximation

Simple Icons does **not** carry some brands (several were removed at the brand
owner's request — e.g. Hulu, Disney+, Prime Video, Hotstar, Amazon, Domino's).
For those, this app draws a plain **brand-coloured tile with short text**
(`kind: 'letter'`). These are our own approximations, **not** the official
logos, and make no claim to be.

## Trademarks

All brand names and logos are trademarks (or registered trademarks) of their
respective owners. They are used here **only to identify the actual product or
service a user is tracking** (nominative use). Their use does **not** imply any
affiliation with, sponsorship by, or endorsement from those owners.

If you are a brand owner and want your mark removed, delete its entry from the
`BRANDS` list in `scripts/gen-brand-logos.mjs` and re-run the generator; the
category will fall back to a generic icon.
