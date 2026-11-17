"use client";

import dynamic from "next/dynamic";

const AccordionGallery = dynamic(() => import("./accordion-gallery"), {
  ssr: false,
  loading: () => <div className="h-[460px] animate-pulse rounded-dialog bg-border/40" />,
});

export default AccordionGallery;
