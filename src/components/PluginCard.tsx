"use client";

import type { PluginPreset } from "@/types/plugins";

type PluginCardProps = {
  plugin: PluginPreset;
};

export default function PluginCard({ plugin }: PluginCardProps) {
  const entries = Object.entries(plugin.settings);

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-white/15 bg-black/40 p-5 shadow-inner shadow-black/60 transition hover:border-white/30 hover:bg-black/30">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-lg font-semibold text-white">{plugin.name}</p>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
            {plugin.type}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-3 text-sm text-slate-200 sm:grid-cols-2">
        {entries.map(([parameter, value]) => (
          <div key={parameter} className="flex flex-col gap-1">
            <dt className="text-xs uppercase tracking-[0.25em] text-slate-500">
              {parameter}
            </dt>
            <dd className="text-sm text-white">{value}</dd>
          </div>
        ))}
      </dl>

      {plugin.comment ? (
        <p className="text-sm italic text-slate-300">“{plugin.comment}”</p>
      ) : null}
    </div>
  );
}
