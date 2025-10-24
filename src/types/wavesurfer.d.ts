declare module "wavesurfer.js/dist/plugins/regions.esm.js" {
  import type WaveSurfer from "wavesurfer.js";

  interface RegionOptions {
    id?: string;
    start: number;
    end?: number;
    drag?: boolean;
    resize?: boolean;
    loop?: boolean;
    color?: string;
  }

  interface RegionsPlugin {
    addRegion(options: RegionOptions): Region;
    enableDragSelection(options?: Partial<RegionOptions>): void;
    clearRegions(): void;
    getRegions(): Record<string, Region>;
    on?(
      event: string,
      listener: (region: Region, event: MouseEvent) => void
    ): void;
    un?(event: string, listener: (region: Region) => void): void;
  }

  interface Region {
    id: string;
    start: number;
    end: number;
    remove(): void;
    setOptions(options: Partial<RegionOptions>): void;
    play(): void;
  }

  interface RegionsPluginParams {
    regions?: RegionOptions[];
    dragSelection?: Partial<RegionOptions>;
  }

  namespace RegionsPlugin {
    function create(
      params?: RegionsPluginParams
    ): (ws: WaveSurfer) => RegionsPlugin;
  }

  export type { Region, RegionOptions, RegionsPlugin };
  export default RegionsPlugin;
}
