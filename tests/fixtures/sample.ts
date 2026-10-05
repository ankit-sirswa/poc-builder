import type { Poc } from "../../shared/schema";

const unsplash = (id: string, width: number) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=80`;

/** Test fixture only: a complete POC. The app itself ships with no sample data. */
export const SAMPLE_POC: Poc = {
  site: {
    name: "Fieldwork Studio",
    wordmark: "fieldwork",
    location: "Portland, Oregon",
    footerLeft: "INDEPENDENT ARCHITECTURE STUDIO",
    footerRight: "BASED IN PORTLAND, OR",
    ctaLabel: "Let's talk ↗",
    ctaPage: "contact",
    accentColor: "#e66d45",
    inkColor: "#374838",
  },
  pages: [
    {
      id: "home",
      title: "Home",
      description: "Hero, studio introduction, featured project",
      sections: [
        {
          type: "hero",
          eyebrow: "Spaces to live a little slower",
          heading: "Make room for a more thoughtful life.",
          body: "We design considered homes rooted in their landscape, built for the way you want to live.",
          ctaLabel: "Explore our work",
          ctaPage: "projects",
          image: {
            seed: "warm-home-interior",
            alt: "Warm, naturally lit contemporary home interior",
            url: unsplash("photo-1600210492486-724fe5c67fb0", 900),
          },
          caption: "A home, in its element / 01",
        },
      ],
    },
    {
      id: "projects",
      title: "Projects",
      description: "Gallery of three sample homes",
      sections: [
        {
          type: "cards",
          eyebrow: "A few places we've made",
          heading: "Homes that know where they belong.",
          body: "A collection of considered renovations and new homes, shaped by their landscape and the lives lived inside them.",
          items: [
            {
              title: "Oak House",
              meta: "Portland · Renovation · 2025",
              image: { seed: "oak-house", alt: "Oak House interior", url: unsplash("photo-1600210492486-724fe5c67fb0", 600) },
            },
            {
              title: "Cedar Ridge",
              meta: "Columbia River · New build · 2024",
              image: { seed: "cedar-ridge", alt: "Cedar Ridge home", url: unsplash("photo-1600607687939-ce8a6c25118c", 600) },
            },
            {
              title: "Garden House",
              meta: "Willamette Valley · Addition · 2024",
              image: { seed: "garden-house", alt: "Garden House interior", url: unsplash("photo-1600566753086-00f18fb6b3ea", 600) },
            },
          ],
        },
      ],
    },
    {
      id: "studio",
      title: "Studio",
      description: "About, approach, and studio facts",
      sections: [
        {
          type: "about",
          eyebrow: "A small studio, with a point of view",
          heading: "Good spaces start with paying attention.",
          paragraphs: [
            "Fieldwork is an independent architecture practice led by Maya Chen and Eli Navarro. We work at the scale of the room and the landscape, making places that feel generous, grounded, and made to last.",
            "Our process is collaborative and hands-on, from the first sketch to the last cabinet pull.",
          ],
          stats: [
            { value: "2016", label: "Studio founded" },
            { value: "12", label: "Years of practice" },
            { value: "2", label: "Studio partners" },
            { value: "OR", label: "Home base" },
          ],
        },
      ],
    },
    {
      id: "contact",
      title: "Contact",
      description: "Sample inquiry form and studio details",
      sections: [
        {
          type: "contact",
          eyebrow: "Start with a conversation",
          heading: "Have a place in mind?",
          body: "Tell us a little about what you are planning. We will be in touch within two working days.",
          submitLabel: "Send an inquiry ↗",
          details: [
            { label: "Visit", value: "2131 SE Division St\nPortland, Oregon" },
            { label: "Email", value: "hello@fieldwork.studio" },
            { label: "Studio hours", value: "Monday–Friday\n9:00–5:00 PST" },
          ],
        },
      ],
    },
  ],
  contentSummary: [
    { label: "Studio name", value: "Fieldwork Studio" },
    { label: "Location", value: "Portland, Oregon" },
    { label: "Project count", value: "6 featured homes" },
    { label: "Primary action", value: "Start a conversation" },
    { label: "Visual direction", value: "Natural, editorial, calm" },
    { label: "Content source", value: "Generated sample data" },
  ],
};
