import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kinetic Pro — 2D Rigging & Animation for Slot Games",
  description:
    "Standalone 2D skeletal, contour Delaunay mesh, weight-painting, and animation studio with Spine 4.2, Unity C# Runtime, and Flipbook Sprite Sheet export.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
