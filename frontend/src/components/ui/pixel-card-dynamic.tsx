"use client";

import dynamic from "next/dynamic";

const PixelCard = dynamic(() => import("./pixel-card"), {
  ssr: false,
  loading: () => <div className="h-[248px] w-full animate-pulse rounded-card border border-border bg-bg-subtle" />,
});

export default PixelCard;
