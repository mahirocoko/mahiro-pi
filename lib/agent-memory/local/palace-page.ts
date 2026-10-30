import { type LocalJobStatus, localJobStatuses } from './contracts.ts'
import {
  type PalaceContextQuality,
  type PalaceContextSnapshot,
  palaceContextBreakdownKeys,
} from './palace-context.ts'
import { type PalaceDocument, palaceMemoryPlacement, renderPalaceMarkdown } from './palace-document.ts'
import { encodePalacePath } from './palace-path.ts'
import { type PalaceGuidance, type PalaceSnapshot, escapePalaceText } from './palace.ts'

export interface PalaceFontFaces {
  manrope: string
  fira: string
}

export const palaceFontFallback: PalaceFontFaces = {
  manrope: 'font/manrope-latin.woff2',
  fira: 'font/firacode-latin.woff2',
}

export type PalacePreviewProvenance = 'synthetic' | 'private-shadow'

export type PalaceRenderPage = (
  | {
      state: 'snapshot'
      snapshot: PalaceSnapshot
      reloadPath: string
      document?: PalaceDocument | null
      focus?: 'context' | 'selection'
    }
  | { state: 'loading'; reloadPath: string }
  | { state: 'error'; reloadPath: string }
  | { state: 'stale'; reloadPath: string }
) & {
  fonts?: PalaceFontFaces
  provenance?: PalacePreviewProvenance
  context?: PalaceContextSnapshot | null
}

const palaceFontFile = {
  manrope: 'manrope-latin.woff2',
  fira: 'firacode-latin.woff2',
} as const

function safeFontHref(value: string, file: string): string {
  const relative = new RegExp(`^(?:[A-Za-z0-9_-]+/font/|(?:\\.\\./){1,8}font/|font/)${file}$`)
  return relative.test(value) ? value : `font/${file}`
}

export function palaceFontFaces(fonts: PalaceFontFaces): PalaceFontFaces {
  return {
    manrope: safeFontHref(fonts.manrope, palaceFontFile.manrope),
    fira: safeFontHref(fonts.fira, palaceFontFile.fira),
  }
}

export function palaceFontHrefs(documentPath: string, pagePath: string): PalaceFontFaces {
  const href = (file: string) => {
    if (!pagePath.startsWith('/') || !documentPath.startsWith(pagePath)) return `font/${file}`
    if (/[?#\\%]/.test(documentPath) || documentPath.includes('..')) return `font/${file}`
    const rest = documentPath.slice(pagePath.length)
    if (rest !== '' && !rest.startsWith('/')) return `font/${file}`
    const extra = rest.split('/').filter(Boolean)
    if (extra.length > 8) return `font/${file}`
    if (extra.length === 0) {
      const segment = pagePath.slice(1)
      if (!/^[A-Za-z0-9_-]+$/.test(segment)) return `font/${file}`
      return `${segment}/font/${file}`
    }
    return `${'../'.repeat(extra.length - 1)}font/${file}`
  }
  return palaceFontFaces({
    manrope: href(palaceFontFile.manrope),
    fira: href(palaceFontFile.fira),
  })
}

const guidanceCopy: Record<PalaceGuidance, string> = {
  'resume-starts': 'Resume would start this waiting job. This preview does not start it.',
  'resume-integrates': 'Resume would publish this ready job. This preview does not publish it.',
  'resume-unchanged': 'Resume would leave this job unchanged.',
  'retry-requeues': 'Retry would queue this failed reflection again. This preview does not retry it.',
  'retry-blocked':
    'Resume and retry cannot advance this state. The synthetic coordinator requires explicit repair resolutions or abandonment.',
  'repaired-unconsumed':
    'Explicit resolutions were published. Conflict evidence is retained; trajectory progress did not advance. A fresh reflection may review it again.',
  'abandoned-unconsumed':
    'Abandoned without publication or trajectory progress. Conflict evidence is retained; a fresh reflection may review it again.',
  'running-recovers-next-turn':
    'The next coordinator turn recovers a running job. This preview does not resume it.',
}

const statusLabel: Record<LocalJobStatus, string> = {
  queued: 'Waiting',
  running: 'Maintaining',
  committed: 'Ready to publish',
  integrated: 'Published',
  noop: 'No change',
  failed: 'Failed',
  'repair-needed': 'Needs repair',
  repaired: 'Repaired',
  abandoned: 'Abandoned',
}

const statusMark: Record<LocalJobStatus, string> = {
  queued: 'o',
  running: '*',
  committed: '#',
  integrated: '+',
  noop: '-',
  failed: '!',
  'repair-needed': 'x',
  repaired: '+',
  abandoned: '-',
}

const groupTitle = {
  baseline: 'Baseline',
  human: 'Human',
  project: 'Project',
  reference: 'Reference',
  library: 'Other library',
} as const

const mahiroMarkSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1254" aria-hidden="true" focusable="false"><path fill="#0a0606" fill-rule="evenodd" d="M 1100.5 857.0 C 1100.8 862.0 1100.0 879.4 1099.5 884.0 C 1099.0 888.6 1096.2 902.0 1094.5 907.0 C 1092.8 912.0 1083.1 934.2 1080.5 939.0 C 1077.9 943.8 1069.8 955.0 1066.5 959.0 C 1063.2 963.0 1048.3 978.6 1044.0 982.5 C 1039.7 986.4 1025.0 998.0 1020.0 1001.5 C 1015.0 1005.0 995.3 1017.1 989.0 1020.5 C 982.7 1023.9 958.6 1035.4 951.0 1038.5 C 943.4 1041.6 914.6 1051.8 906.0 1054.5 C 897.4 1057.2 869.9 1064.8 857.0 1067.5 C 844.1 1070.2 783.2 1081.3 765.0 1083.5 C 746.8 1085.7 678.5 1091.0 658.0 1091.5 C 637.5 1092.0 560.2 1090.1 541.0 1088.5 C 521.8 1086.9 463.2 1077.6 448.0 1074.5 C 432.8 1071.4 388.4 1059.3 375.0 1054.5 C 361.6 1049.7 313.1 1028.3 302.0 1022.5 C 290.9 1016.7 263.0 998.8 254.0 991.5 C 245.0 984.2 211.2 951.9 203.5 943.0 C 195.8 934.1 174.8 903.4 169.5 894.0 C 164.2 884.6 148.6 848.5 145.5 840.0 C 142.4 831.5 136.8 807.5 135.5 801.0 C 134.2 794.5 131.9 775.1 131.5 769.0 C 131.1 762.9 130.9 741.1 131.5 734.0 C 132.1 726.9 135.8 699.2 137.5 691.0 C 139.2 682.8 147.8 651.9 150.5 644.0 C 153.2 636.1 166.7 614.0 167.5 605.0 C 168.3 596.0 160.3 558.2 159.5 546.0 C 158.7 533.8 157.6 487.3 158.5 472.0 C 159.4 456.7 166.8 394.5 169.5 379.0 C 172.2 363.5 183.0 317.4 187.5 303.0 C 192.0 288.6 213.0 233.6 218.5 222.0 C 224.0 210.4 243.6 182.3 247.5 177.0 C 251.4 171.7 258.2 166.5 261.0 164.5 C 263.8 162.5 273.2 156.6 278.0 155.5 C 282.8 154.4 307.5 152.2 313.0 152.5 C 318.5 152.8 333.2 156.8 338.0 158.5 C 342.8 160.2 356.9 165.6 365.0 170.5 C 373.1 175.4 414.4 202.7 426.0 212.5 C 437.6 222.3 479.8 263.6 491.5 277.0 C 503.2 290.4 539.0 351.0 554.0 358.5 C 569.0 366.0 640.2 357.7 655.0 358.5 C 669.8 359.3 707.0 366.0 715.0 367.5 C 723.0 369.0 736.0 377.4 742.0 374.5 C 748.0 371.6 773.6 341.6 780.0 335.5 C 786.4 329.4 802.0 315.6 812.0 308.5 C 822.0 301.4 878.9 263.6 889.0 257.5 C 899.1 251.4 916.4 244.6 922.0 242.5 C 927.6 240.4 945.2 235.2 950.0 234.5 C 954.8 233.8 970.2 233.8 974.0 234.5 C 977.8 235.2 988.3 240.3 991.0 242.5 C 993.7 244.7 1001.2 254.4 1003.5 259.0 C 1005.8 263.6 1014.0 282.8 1016.5 293.0 C 1019.0 303.2 1029.1 354.3 1030.5 370.0 C 1031.9 385.7 1032.6 448.0 1031.5 464.0 C 1030.4 480.0 1017.5 533.5 1018.5 545.0 C 1019.5 556.5 1038.4 579.6 1042.5 589.0 C 1046.6 598.4 1060.6 637.5 1063.5 648.0 C 1066.4 658.5 1072.8 692.0 1074.5 704.0 C 1076.2 716.0 1079.5 767.5 1081.5 779.0 C 1083.5 790.5 1094.8 821.9 1096.5 829.0 C 1098.2 836.1 1100.2 852.0 1100.5 857.0 Z"/><path fill="#a552fc" fill-rule="evenodd" d="M 441.5 408.0 C 442.4 411.3 442.3 415.2 441.5 417.0 C 440.7 418.8 437.7 424.2 433.0 427.5 C 428.3 430.8 398.2 447.2 390.0 452.5 C 381.8 457.8 354.6 475.4 343.0 485.5 C 331.4 495.6 271.9 555.4 264.0 562.5 C 256.1 569.6 258.1 562.9 257.0 562.5 C 255.9 562.1 252.9 560.3 251.5 558.0 C 250.1 555.7 243.2 542.7 241.5 537.0 C 239.8 531.3 234.5 503.9 233.5 496.0 C 232.5 488.1 230.5 461.0 230.5 451.0 C 230.5 441.0 231.8 400.3 233.5 387.0 C 235.2 373.7 245.1 318.7 248.5 306.0 C 251.9 293.3 267.4 254.6 270.5 248.0 C 273.6 241.4 280.3 236.0 282.0 234.5 C 283.7 233.0 287.0 231.5 289.0 231.5 C 291.0 231.5 300.8 233.1 304.0 234.5 C 307.2 235.9 317.8 241.2 324.0 246.5 C 330.2 251.8 363.2 282.5 371.5 292.0 C 379.8 301.5 409.0 341.8 414.5 350.0 C 420.0 358.2 429.0 375.7 431.5 381.0 C 434.0 386.3 440.6 404.7 441.5 408.0 Z"/><path fill="#fdf5d9" fill-rule="evenodd" d="M 767.5 708.0 C 768.3 715.8 766.9 744.2 765.5 751.0 C 764.1 757.8 754.9 777.7 752.5 782.0 C 750.1 786.3 741.5 795.2 739.0 797.5 C 736.5 799.8 729.6 805.5 725.0 807.5 C 720.4 809.5 694.1 818.3 689.0 819.5 C 683.9 820.7 673.1 820.8 669.0 820.5 C 664.9 820.2 649.4 818.4 644.0 816.5 C 638.6 814.6 615.4 803.7 610.0 799.5 C 604.6 795.3 588.4 774.9 585.5 771.0 C 582.6 767.1 579.8 760.8 578.5 757.0 C 577.2 753.2 572.1 734.9 571.5 730.0 C 570.9 725.1 571.1 708.1 571.5 704.0 C 571.9 699.9 573.5 689.9 575.5 685.0 C 577.5 680.1 590.2 655.7 593.5 651.0 C 596.8 646.3 607.5 636.3 611.0 633.5 C 614.5 630.7 626.8 622.6 632.0 620.5 C 637.2 618.4 662.0 611.2 668.0 610.5 C 674.0 609.8 693.2 611.5 698.0 612.5 C 702.8 613.5 716.9 619.9 720.0 621.5 C 723.1 623.1 729.7 628.3 732.0 630.5 C 734.3 632.7 743.3 642.7 745.5 646.0 C 747.7 649.3 754.5 660.3 756.5 666.0 C 758.5 671.7 766.7 700.2 767.5 708.0 Z M 758.5 702.0 C 759.0 706.0 759.2 718.6 758.5 723.0 C 757.8 727.4 752.4 746.1 750.5 750.0 C 748.6 753.9 740.5 763.4 738.0 765.5 C 735.5 767.6 725.9 772.0 723.0 772.5 C 720.1 773.0 709.1 771.8 706.0 770.5 C 702.9 769.2 692.0 760.8 689.5 758.0 C 687.0 755.2 680.1 744.1 678.5 740.0 C 676.9 735.9 672.9 717.8 672.5 713.0 C 672.1 708.2 673.7 691.9 674.5 688.0 C 675.3 684.1 679.5 673.2 681.5 670.0 C 683.5 666.8 693.6 655.5 696.0 653.5 C 698.4 651.5 705.2 648.8 708.0 648.5 C 710.8 648.2 723.6 648.9 727.0 650.5 C 730.4 652.1 743.2 663.4 745.5 666.0 C 747.8 668.6 751.3 675.7 752.5 679.0 C 753.7 682.3 758.0 698.0 758.5 702.0 Z M 1053.5 764.0 C 1053.7 770.5 1051.0 789.8 1049.5 795.0 C 1048.0 800.2 1040.2 817.3 1037.5 821.0 C 1034.8 824.7 1023.6 834.0 1020.0 835.5 C 1016.4 837.0 1001.5 838.0 998.0 837.5 C 994.5 837.0 985.1 832.0 982.0 829.5 C 978.9 827.0 967.1 814.0 964.5 810.0 C 961.9 806.0 955.1 791.4 953.5 786.0 C 951.9 780.6 947.7 757.3 947.5 751.0 C 947.3 744.7 950.0 722.6 951.5 717.0 C 953.0 711.4 961.1 693.8 963.5 690.0 C 965.9 686.2 974.5 677.4 978.0 675.5 C 981.5 673.6 998.3 669.5 1002.0 669.5 C 1005.7 669.5 1015.0 673.3 1018.0 675.5 C 1021.0 677.7 1031.8 688.6 1034.5 693.0 C 1037.2 697.4 1045.8 717.5 1047.5 724.0 C 1049.2 730.5 1053.3 757.5 1053.5 764.0 Z M 1048.5 743.0 C 1049.3 749.0 1047.2 770.9 1046.5 775.0 C 1045.8 779.1 1041.8 786.1 1040.5 788.0 C 1039.2 789.9 1033.8 794.9 1032.0 795.5 C 1030.2 796.1 1023.2 795.8 1021.0 794.5 C 1018.8 793.2 1010.2 783.5 1008.5 781.0 C 1006.8 778.5 1003.4 770.4 1002.5 767.0 C 1001.6 763.6 998.5 749.0 998.5 744.0 C 998.5 739.0 1001.8 715.7 1002.5 712.0 C 1003.2 708.3 1005.1 705.5 1006.5 704.0 C 1007.9 702.5 1016.0 696.0 1018.0 695.5 C 1020.0 695.0 1026.2 697.3 1028.0 698.5 C 1029.8 699.7 1035.6 704.9 1037.5 709.0 C 1039.4 713.1 1047.7 737.0 1048.5 743.0 Z M 915.5 860.0 C 915.9 861.1 916.1 865.6 915.5 867.0 C 914.9 868.4 911.2 874.4 909.0 875.5 C 906.8 876.6 893.7 878.7 891.0 878.5 C 888.3 878.3 882.0 875.1 880.0 873.5 C 878.0 871.9 871.7 860.8 869.0 860.5 C 866.3 860.2 854.9 869.6 851.0 870.5 C 847.1 871.4 830.1 871.0 827.0 870.5 C 823.9 870.0 819.0 867.3 817.0 865.5 C 815.0 863.7 806.6 852.9 805.5 851.0 C 804.4 849.1 805.0 846.1 805.5 845.0 C 806.0 843.9 808.3 839.2 811.0 839.5 C 813.7 839.8 831.7 847.8 835.0 848.5 C 838.3 849.2 844.8 848.4 847.0 847.5 C 849.2 846.6 856.9 840.7 858.5 839.0 C 860.1 837.3 863.8 829.6 865.0 828.5 C 866.2 827.4 870.8 827.2 872.0 827.5 C 873.2 827.8 877.4 830.2 878.5 832.0 C 879.6 833.8 882.4 844.9 883.5 847.0 C 884.6 849.1 888.5 853.7 891.0 854.5 C 893.5 855.3 908.8 855.0 911.0 855.5 C 913.2 856.0 915.1 858.9 915.5 860.0 Z"/></svg>'

export function palacePreviewStyle(fonts: PalaceFontFaces = palaceFontFallback): string {
  const faces = palaceFontFaces(fonts)
  return `
    /* Adapted from Letta Code src/web/memory-viewer-template.txt
       commit 5dea67021b99810707ff753db35e4534f70ff1fd, Apache-2.0.
       Mahiro modifications: local font files, dark-only tokens, Mahiro mark,
       private payload removed, existing data and security binding, hidden-attribute
       views, and 600/320 overflow rules. */
    @font-face {
      font-family: Manrope;
      font-style: normal;
      font-weight: 300 700;
      font-display: swap;
      src: url("${faces.manrope}") format("woff2");
    }
    @font-face {
      font-family: "Fira Code";
      font-style: normal;
      font-weight: 400 500;
      font-display: swap;
      src: url("${faces.fira}") format("woff2");
    }
    :root {
      color-scheme: dark;
      --accent: hsl(240, 80%, 68%);
      --accent-light: hsl(240, 20%, 18%);
      --accent-light-border: hsl(240, 15%, 25%);
      --bg: hsl(0, 0%, 11%);
      --panel: hsl(0, 0%, 13%);
      --surface: hsl(0, 0%, 15%);
      --surface-2: hsl(0, 0%, 18%);
      --hover: hsl(0, 0%, 18%);
      --hover-accent: hsl(240, 15%, 20%);
      --border: hsl(210, 3%, 20%);
      --text: hsl(210, 7%, 84%);
      --text-muted: hsl(210, 3%, 60%);
      --text-dim: hsl(210, 3%, 42%);
      --mono: "Fira Code", Menlo, Courier, monospace;
      --sans: Manrope, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      --serif: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
      --radius: 6px;
      --max-w: 1180px;
      --diff-add-bg: hsl(140, 30%, 14%);
      --diff-del-bg: hsl(0, 40%, 16%);
      --diff-hunk-bg: hsl(210, 30%, 16%);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--mono);
      color: var(--text);
      background: var(--bg);
      line-height: 1.55;
      font-weight: 400;
      font-size: 13px;
    }
    h1, h2, h3, p, ul, ol, dl, pre, code { overflow-wrap: anywhere; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    a:focus-visible, summary:focus-visible, input:focus-visible, select:focus-visible, button:focus-visible {
      outline: 3px solid var(--accent);
      outline-offset: 2px;
    }
    button, input, select, .tabs a { min-block-size: 2.75rem; }
    .skip-link:where(:not(:focus-visible)) {
      position: absolute;
      clip-path: inset(50%);
      overflow: hidden;
      inline-size: 1px;
      block-size: 1px;
      margin: -1px;
      padding: 0;
      border: 0;
      white-space: nowrap;
    }
    .skip-link:focus-visible {
      position: fixed;
      inset-block-start: 0.5rem;
      inset-inline-start: 0.5rem;
      z-index: 3;
      background: var(--panel);
      color: var(--text);
    }
    [hidden] { display: none !important; }
    @media (prefers-reduced-motion: reduce) {
      html { scroll-behavior: auto; }
      *, *::before, *::after { animation: none !important; transition: none !important; }
    }
    .app-shell {
      max-width: min(var(--max-w), 100%);
      max-inline-size: min(1180px, 100%);
      margin: 22px auto;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--panel);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2), 0 6px 16px rgba(0, 0, 0, 0.3);
      min-inline-size: 0;
    }
    .header {
      padding: 14px 20px;
      border-bottom: 1px solid var(--border);
      background: var(--panel);
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }
    .header-brand {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 8px;
    }
    .product-mark {
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #DED0FD;
      border-radius: 6px;
      flex: 0 0 auto;
    }
    .product-mark svg { width: 24px; height: 24px; display: block; }
    .product-name {
      font-family: var(--sans);
      font-size: 13px;
      font-weight: 500;
      color: var(--text);
    }
    .header .agent-meta { margin-left: auto; text-align: right; }
    .header .agent-name, .header h1.agent-name {
      display: block;
      font-family: var(--sans);
      font-size: 13px;
      font-weight: 500;
      color: var(--text-muted);
      letter-spacing: 0;
      text-transform: none;
      margin: 0;
    }
    .header .agent-id {
      font-family: var(--mono);
      font-size: 11px;
      color: var(--text-dim);
    }
    .tabs {
      display: flex;
      border-bottom: 1px solid var(--border);
      background: var(--surface-2);
      overflow-x: auto;
      max-inline-size: 100%;
    }
    .tabs ul {
      display: flex;
      flex-wrap: nowrap;
      margin: 0;
      padding: 0;
      list-style: none;
      inline-size: max-content;
      min-inline-size: 100%;
    }
    .tab {
      padding: 10px 16px;
      cursor: pointer;
      font-size: 10px;
      font-weight: 400;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: var(--text-muted);
      user-select: none;
      text-decoration: none;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
    }
    .tab:hover { color: var(--text); text-decoration: none; }
    .tab[aria-current="page"] {
      color: var(--accent);
      background: var(--panel);
      box-shadow: inset 0 -2px 0 var(--accent);
    }
    .main { padding: 16px; min-inline-size: 0; }
    .files-layout {
      display: grid;
      grid-template-columns: 320px minmax(0, 1fr);
      gap: 16px;
      height: 74vh;
    }
    .panel {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      background: var(--panel);
      min-inline-size: 0;
    }
    .tree-panel { overflow: auto; background: var(--surface-2); }
    .file-panel { display: flex; flex-direction: column; }
    .file-chars, .file-size {
      color: var(--text-dim);
      font-size: 11px;
      opacity: 0.6;
    }
    .tree-desc {
      padding: 8px 12px;
      font-size: 10px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: var(--text-dim);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      background: var(--surface-2);
      z-index: 1;
      margin: 0;
      font-weight: 400;
    }
    .file-list { list-style: none; margin: 0; padding: 0; }
    .file-list .file-list {
      margin-left: 12px;
      padding-left: 8px;
      border-left: 1px solid var(--border);
    }
    .file-list summary, .file-link {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      font-size: 13px;
      color: var(--text);
      text-decoration: none;
      min-inline-size: 0;
    }
    .file-list summary { list-style: none; cursor: pointer; user-select: none; }
    .file-list summary::-webkit-details-marker { display: none; }
    .file-list summary::before { content: "▸"; inline-size: 0.8rem; flex: 0 0 auto; color: var(--text-dim); }
    .file-list details[open] > summary::before { content: "▾"; }
    .file-list details[open] > summary { box-shadow: inset 2px 0 0 var(--accent); }
    .file-link:hover, .file-list summary:hover { background: var(--hover-accent); text-decoration: none; }
    .file-link[aria-current="page"] {
      background: var(--accent-light);
      color: var(--accent);
      font-weight: 600;
      box-shadow: inset 2px 0 0 var(--accent);
    }
    .file-path, .folder-name {
      flex: 1 1 auto;
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }
    .file-size, .folder-count {
      margin-left: auto;
      flex: 0 0 auto;
      white-space: nowrap;
      font-size: 11px;
      color: var(--text-dim);
      font-weight: 400;
      padding-right: 4px;
    }
    .file-link .file-meta { display: none; }
    .group-heading {
      margin: 12px 10px 4px;
      font-size: 10px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: var(--text-dim);
      font-weight: 400;
    }
    .file-last-commit {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 14px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      font-size: 12px;
    }
    .file-last-commit .lc-hash {
      font-family: var(--mono);
      font-size: 11px;
      color: var(--accent);
      background: var(--accent-light);
      border-radius: 3px;
      padding: 1px 5px;
      flex-shrink: 0;
    }
    .file-last-commit .lc-msg {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text);
    }
    .file-last-commit .lc-meta {
      color: var(--text-dim);
      white-space: nowrap;
      flex-shrink: 0;
    }
    .file-panel > .file-meta {
      position: relative;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      padding: 10px 14px;
    }
    .file-panel > .file-meta .file-path, #document-title {
      font-family: var(--mono);
      font-size: 12px;
      font-weight: 400;
      letter-spacing: 0;
      text-transform: none;
      color: var(--text);
      margin: 0 0 6px;
    }
    .meta-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .meta-pill {
      font-size: 12px;
      color: var(--text-muted);
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 2px 8px;
    }
    .meta-pill strong { color: var(--text); }
    .raw-toggle {
      font-size: 11px;
      padding: 3px 8px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: var(--panel);
      color: var(--text-muted);
      cursor: pointer;
      font-family: inherit;
    }
    .raw-toggle:hover { background: var(--accent-light); color: var(--accent); }
    .raw-toggle[aria-pressed="true"] { background: var(--accent); color: #fff; border-color: var(--accent); }
    .file-body {
      padding: 20px 28px;
      flex: 1;
      overflow: auto;
      min-height: 0;
      font-family: var(--serif);
      font-size: 16px;
      color: var(--text);
    }
    .file-body h1, .file-body h2, .file-body h3 { margin-top: 18px; margin-bottom: 8px; color: var(--text); }
    .file-body h1 { font-size: 30px; }
    .file-body h2 { font-size: 23px; border-bottom: 1px solid var(--border); padding-bottom: 3px; }
    .file-body h3 { font-size: 18px; }
    .file-body p, .file-body ul, .file-body ol, .file-body pre, .file-body table, .file-body blockquote { margin-bottom: 12px; }
    .file-body ul, .file-body ol { padding-left: 28px; }
    .file-body code {
      font-family: var(--mono);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 1px 5px;
      font-size: 13px;
    }
    .file-body pre {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      overflow: auto;
    }
    .file-body pre code { border: none; background: transparent; padding: 0; }
    .file-body blockquote {
      border-left: 3px solid var(--accent);
      padding-left: 10px;
      color: var(--text-muted);
    }
    .file-body-raw {
      padding: 20px 28px;
      flex: 1;
      overflow: auto;
      min-height: 0;
      font-family: var(--mono);
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.6;
      color: var(--text);
      background: var(--surface-2);
    }
    .history-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      margin-bottom: 12px;
    }
    .history-search-group {
      display: flex;
      gap: 8px;
      align-items: center;
      flex: 1;
      min-width: 0;
      min-inline-size: 0;
    }
    .history-field { display: flex; flex-direction: column; gap: 4px; min-inline-size: 0; flex: 1; }
    .history-field-activity { flex: 0 0 auto; }
    .history-search-input, .history-search-select, #memory-filter {
      border: 1px solid var(--border);
      background: var(--panel);
      color: var(--text);
      border-radius: 8px;
      padding: 9px 11px;
      font: inherit;
      inline-size: 100%;
    }
    .history-search-input { flex: 1; min-width: 0; min-inline-size: 0; }
    .history-search-input::placeholder { color: var(--text-dim); }
    .history-search-select { flex: 0 0 auto; }
    .history-search-status, .note {
      font-size: 12px;
      color: var(--text-dim);
    }
    .note { padding: 8px 12px; }
    .commit-list, .history-list { list-style: none; display: flex; flex-direction: column; gap: 0; }
    .commit-item {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      margin-bottom: 10px;
      overflow: hidden;
      background: var(--panel);
      min-inline-size: 0;
    }
    .commit-head {
      padding: 11px 13px;
      display: grid;
      grid-template-columns: 110px minmax(0, 1fr) auto;
      align-items: start;
      column-gap: 10px;
      row-gap: 0;
    }
    .commit-hash {
      font-family: var(--mono);
      font-size: 11px;
      color: var(--accent);
      background: var(--accent-light);
      border-radius: 4px;
      padding: 2px 6px;
    }
    .commit-center { display: flex; flex-direction: column; min-width: 0; min-inline-size: 0; }
    .commit-title { font-size: 13px; font-weight: 400; word-break: break-word; color: var(--text); margin: 0; }
    .commit-preview {
      font-size: 12px;
      color: var(--text-dim);
      line-height: 1.4;
      overflow-wrap: anywhere;
      margin: 0;
    }
    .commit-meta { text-align: right; font-size: 11px; color: var(--text-dim); }
    .context-layout { display: flex; gap: 0; min-height: 400px; min-inline-size: 0; }
    .context-grid-area {
      position: relative;
      flex: 1;
      padding: 20px;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      min-inline-size: 0;
      overflow: clip;
      overflow-clip-margin: 4px;
    }
    .context-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      max-width: min(700px, 100%);
      padding: 8px;
    }
    .context-grid .block {
      width: 18px;
      height: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      line-height: 1;
      cursor: default;
      user-select: none;
    }
    .ctx-system { color: rgb(224, 112, 80); }
    .ctx-core { color: rgb(224, 160, 64); }
    .ctx-external { color: rgb(32, 178, 170); }
    .ctx-summary { color: rgb(160, 160, 160); }
    .ctx-tools { color: rgb(94, 196, 168); }
    .ctx-messages { color: rgb(140, 140, 249); }
    .ctx-unattributed { color: rgb(176, 144, 96); }
    .ctx-free { color: var(--text-dim); }
    .block.ctx-free { opacity: 0.25; }
    .ctx-legend-sym.ctx-free { opacity: 0.4; }
    .context-sidebar {
      width: 280px;
      padding: 20px;
      border-left: 1px solid var(--border);
      background: var(--surface);
      min-inline-size: 0;
    }
    .ctx-model { font-size: 14px; font-weight: 400; color: var(--text); margin-bottom: 2px; }
    .ctx-model-sub { font-size: 11px; color: var(--text-dim); margin-bottom: 12px; }
    .ctx-usage-label { font-size: 13px; color: var(--text-muted); margin-bottom: 6px; }
    .ctx-bar-track {
      height: 6px;
      background: var(--surface-2);
      border-radius: 3px;
      overflow: hidden;
      margin-bottom: 4px;
    }
    .ctx-bar-fill { height: 100%; border-radius: 3px; background: var(--accent); }
    .ctx-bar-text { font-size: 11px; color: var(--text-dim); margin-bottom: 20px; }
    .ctx-legend-title {
      font-size: 10px;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: var(--text-dim);
      margin-bottom: 10px;
    }
    .ctx-legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      font-size: 12px;
      color: var(--text-muted);
    }
    button.ctx-legend-item {
      min-block-size: 0;
      inline-size: 100%;
      border: 0;
      background: transparent;
      font: inherit;
      text-align: start;
      cursor: pointer;
    }
    .ctx-legend-sym { font-size: 14px; width: 18px; text-align: center; flex: 0 0 auto; }
    .ctx-legend-sym.ctx-unloaded { opacity: 0.4; }
    .ctx-legend-name { flex: 1; min-inline-size: 0; }
    .ctx-legend-arrow { font-size: 10px; color: var(--text-dim); margin-left: 4px; }
    .ctx-legend-value { text-align: right; color: var(--text-dim); }
    .ctx-note { margin-top: 16px; font-size: 11px; color: var(--text-dim); }
    .ctx-summary {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
      border: 0;
    }
    ${contextCoverageCss()}
    .empty { padding: 24px; text-align: center; color: var(--text-dim); }
    .show-more, #load-more {
      margin-top: 8px;
      width: 100%;
      border: 1px dashed var(--border);
      background: var(--accent-light);
      color: var(--accent);
      border-radius: 8px;
      padding: 10px;
      cursor: pointer;
      font: inherit;
    }
    #load-more:hover, .show-more:hover { background: hsl(240, 15%, 22%); }
    footer {
      margin-top: 14px;
      border-top: 1px solid var(--border);
      padding: 10px 16px 14px;
      font-size: 12px;
      color: var(--text-dim);
      text-align: center;
    }
    .table-wrapper { overflow-x: auto; max-inline-size: 100%; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
    th { background: var(--surface); }
    caption { text-align: start; font-weight: 600; padding-bottom: 0.35rem; }
    search label { display: block; margin-bottom: 4px; color: var(--text-dim); font-size: 11px; }
    @media (max-width: 900px) {
      .files-layout { grid-template-columns: minmax(0, 1fr); height: auto; }
      .tree-panel { max-block-size: 240px; }
      .header {
        display: grid;
        grid-template-areas: "brand reload" "meta meta";
        grid-template-columns: auto auto;
        justify-content: start;
        align-items: start;
        min-inline-size: 0;
      }
      .header-brand { grid-area: brand; min-inline-size: 0; }
      .header > a { grid-area: reload; margin-inline-start: 0; align-self: start; }
      .header .agent-meta {
        grid-area: meta;
        inline-size: min(100%, 42ch);
        max-inline-size: 100%;
        justify-self: start;
        min-inline-size: 0;
        margin-left: 0;
        text-align: start;
      }
      .header .agent-id {
        inline-size: min(100%, 42ch);
        max-inline-size: 42ch;
        white-space: normal;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .context-layout { flex-direction: column; }
      .context-sidebar { width: auto; border-left: 0; border-top: 1px solid var(--border); }
    }
    @media (max-width: 700px) {
      .history-search-group { inline-size: 100%; flex-wrap: wrap; }
      .history-search-status { white-space: normal; }
    }
    @media (max-width: 600px) {
      .app-shell { margin: 8px auto; }
      .header .agent-meta { margin-left: 0; text-align: start; }
      .commit-head { grid-template-columns: minmax(0, 1fr); }
      .history-toolbar { flex-direction: column; align-items: stretch; }
      .history-search-group { flex-direction: column; align-items: stretch; }
      .history-field, .history-field-activity, .history-search-input, .history-search-select { inline-size: 100%; flex: 1 1 auto; }
    }
    @media (max-width: 320px) {
      .app-shell { margin: 4px; border-radius: 4px; }
      .main, .header { padding: 8px; }
    }
  `.trim()
}

export function palacePreviewScript(): string {
  return String.raw`(() => {
  const fence = String.fromCharCode(96, 96, 96)
  const tick = String.fromCharCode(96)
  const codePattern = new RegExp('^' + tick + '([^' + tick + ']+)' + tick)
  const browser = document.querySelector('#memory-browser')
  const filter = document.querySelector('#memory-filter')
  const count = document.querySelector('#memory-count')
  const title = document.querySelector('#document-title')
  const meta = document.querySelector('#document-meta')
  const rendered = document.querySelector('#document-rendered')
  const raw = document.querySelector('#document-raw')
  const status = document.querySelector('#document-status')
  const root = document.querySelector('[data-palace-commit]')
  if (!browser || !filter || !count || !title || !meta || !rendered || !raw || !status || !root) return
  const commit = root.getAttribute('data-palace-commit') || ''
  const pagePath = root.getAttribute('data-palace-page') || ''
  if (!commit || pagePath.indexOf('//') !== -1 || pagePath.indexOf('..') !== -1 || pagePath.indexOf('%') !== -1) return
  const documentPrefix = root.getAttribute('data-palace-document') || ''
  const readPrefix = root.getAttribute('data-palace-read') || ''
  const corpusRoot = root.getAttribute('data-palace-corpus') || ''
  if (
    documentPrefix !== pagePath + '/document/' + commit + '/' ||
    readPrefix !== pagePath + '/read/' + commit + '/' ||
    corpusRoot !== pagePath + '/corpus/' + commit
  )
    return
  const loadMore = document.querySelector('#load-more')
  const noMatch = document.querySelector('#filter-empty')
  const rows = () => Array.from(browser.querySelectorAll('li[data-path]'))
  const links = () => Array.from(browser.querySelectorAll('a[data-path]'))
  const applyFilter = () => {
    const query = filter.value.trim().toLowerCase()
    for (const row of rows()) {
      const path = (row.getAttribute('data-path') || '').toLowerCase()
      row.hidden = query.length > 0 && path.indexOf(query) === -1
    }
    const total = links().length
    let shown = 0
    for (const link of links()) {
      const row = link.closest('li')
      if (!row || !row.hidden) shown += 1
    }
    const noun = (value) => value + (value === 1 ? ' file' : ' files')
    const corpusTotal = root.getAttribute('data-corpus-total') || '0'
    count.textContent = noun(total) + ' loaded / ' + corpusTotal + ' total entries' + (query ? ' · ' + shown + ' matches' : '')
    if (noMatch) noMatch.hidden = shown > 0 || !query
    for (const folder of browser.querySelectorAll('details[data-folder]')) {
      const descendants = Array.from(folder.querySelectorAll('li[data-path]'))
      folder.hidden = descendants.every((row) => row.hidden)
      if (query && !folder.hidden) folder.open = true
    }
    for (const group of browser.querySelectorAll('[data-memory-group]')) {
      const descendants = Array.from(group.querySelectorAll('li[data-path]'))
      group.hidden = descendants.every((row) => row.hidden)
      const badge = group.querySelector('[data-group-count]')
      if (badge) badge.textContent = '(' + descendants.length + ')'
    }
    for (const folder of browser.querySelectorAll('details[data-folder]')) {
      const badge = folder.querySelector('[data-folder-count]')
      if (badge) badge.textContent = '(' + folder.querySelectorAll('li[data-path]').length + ')'
    }
    const tabLabel = (name) => {
      const slot = document.querySelector('[data-tab-count="' + name + '"]')
      const tree = browser.querySelector('[data-tree="' + name + '"]')
      if (!slot || !tree) return
      let loaded = 0
      for (const link of tree.querySelectorAll('a[data-path]')) loaded += 1
      const exact = root.getAttribute('data-corpus-truncated') !== 'true'
      slot.textContent = exact ? String(loaded) : String(loaded) + ' loaded'
    }
    tabLabel('core')
    tabLabel('external')
  }
  const clear = (node) => {
    while (node.firstChild) node.removeChild(node.firstChild)
  }
  const addText = (parent, tag, text) => {
    const node = document.createElement(tag)
    node.textContent = text
    parent.append(node)
    return node
  }
  const takeLink = (value) => {
    const image = value.indexOf('![') === 0
    const start = image ? 2 : value.indexOf('[') === 0 ? 1 : -1
    if (start < 0) return null
    const marker = value.indexOf('](', start)
    if (marker <= start) return null
    const label = value.slice(start, marker)
    if (label.indexOf('\n') !== -1) return null
    let depth = 0
    for (let cursor = marker + 2; cursor < value.length; cursor += 1) {
      const char = value[cursor]
      if (char === '(') depth += 1
      else if (char === ')') {
        if (depth === 0) return { label: label, rest: value.slice(cursor + 1) }
        depth -= 1
      } else if (char === '\n') return null
    }
    return null
  }
  const appendInline = (parent, value) => {
    let rest = value
    while (rest.length > 0) {
      const before = rest.length
      const code = codePattern.exec(rest)
      const linked = rest.indexOf('[') === 0 || rest.indexOf('![') === 0 ? takeLink(rest) : null
      const strong = /^\*\*([^*]+)\*\*/.exec(rest)
      const emphasis = /^\*([^*]+)\*/.exec(rest)
      if (code && code.index === 0) {
        addText(parent, 'code', code[1] || '')
        rest = rest.slice(code[0].length)
      } else if (linked && linked.rest.length < rest.length) {
        parent.append(document.createTextNode(linked.label))
        rest = linked.rest
      } else if (strong && strong.index === 0) {
        addText(parent, 'strong', strong[1] || '')
        rest = rest.slice(strong[0].length)
      } else if (emphasis && emphasis.index === 0) {
        addText(parent, 'em', emphasis[1] || '')
        rest = rest.slice(emphasis[0].length)
      } else {
        parent.append(document.createTextNode(rest[0] || ''))
        rest = rest.slice(1)
      }
      if (rest.length >= before) rest = rest.slice(1)
    }
  }
  const render = (markdown) => {
    clear(rendered)
    const lines = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
    let index = 0
    const blockStart = (line) =>
      line.indexOf(fence) === 0 ||
      /^#{1,3} /.test(line) ||
      line.indexOf('> ') === 0 ||
      /^[-*] /.test(line) ||
      /^\d{1,2}\. /.test(line)
    while (index < lines.length) {
      const lineStart = index
      const line = lines[index] || ''
      if (line.trim() === '') {
        index += 1
      } else if (line.indexOf(fence) === 0) {
        const code = []
        index += 1
        while (index < lines.length && (lines[index] || '').indexOf(fence) !== 0) {
          code.push(lines[index] || '')
          index += 1
        }
        if (index < lines.length) index += 1
        const pre = document.createElement('pre')
        addText(pre, 'code', code.join('\n'))
        rendered.append(pre)
      } else if (/^(#{1,3}) (.*)$/.test(line)) {
        const heading = /^(#{1,3}) (.*)$/.exec(line)
        const node = document.createElement('h' + ((heading[1] || '').length + 2))
        appendInline(node, heading[2] || '')
        rendered.append(node)
        index += 1
      } else if (line.indexOf('> ') === 0) {
        const quote = []
        while (index < lines.length && (lines[index] || '').indexOf('> ') === 0) {
          quote.push((lines[index] || '').slice(2))
          index += 1
        }
        if (quote.length > 0) {
          const block = document.createElement('blockquote')
          const paragraph = document.createElement('p')
          appendInline(paragraph, quote.join(' '))
          block.append(paragraph)
          rendered.append(block)
        }
      } else if (/^[-*] /.test(line) || /^\d{1,2}\. /.test(line)) {
        const ordered = /^\d{1,2}\. /.test(line)
        const list = document.createElement(ordered ? 'ol' : 'ul')
        const pattern = ordered ? /^\d{1,2}\. / : /^[-*] /
        while (index < lines.length && pattern.test(lines[index] || '')) {
          const item = document.createElement('li')
          const current = lines[index] || ''
          appendInline(item, ordered ? current.replace(/^\d{1,2}\. /, '') : current.slice(2))
          list.append(item)
          index += 1
        }
        if (list.childNodes && list.childNodes.length) rendered.append(list)
      } else {
        const paragraph = document.createElement('p')
        const parts = []
        while (index < lines.length && (lines[index] || '').trim() !== '' && !blockStart(lines[index] || '')) {
          parts.push(lines[index] || '')
          index += 1
        }
        if (parts.length > 0) {
          appendInline(paragraph, parts.join(' '))
          rendered.append(paragraph)
        }
      }
      if (index <= lineStart) {
        const paragraph = document.createElement('p')
        appendInline(paragraph, line)
        rendered.append(paragraph)
        index = lineStart + 1
      }
    }
  }
  let selectedPath = root.getAttribute('data-palace-selected') || ''
  if (!selectedPath) {
    for (const link of links()) {
      if (link.getAttribute('aria-current') === 'page') {
        selectedPath = link.getAttribute('data-path') || ''
        break
      }
    }
  }
  const select = (path) => {
    selectedPath = path
    for (const link of links()) {
      if (link.getAttribute('data-path') === path) link.setAttribute('aria-current', 'page')
      else link.removeAttribute('aria-current')
    }
    if (path) showView(viewForPath(path))
  }
  const metaText = (body) => {
    const place = body.placement === 'baseline' ? 'Baseline prompt' : 'On-demand library'
    const project = body.group === 'project' ? ' Project notes are not automatic context.' : ''
    const size = body.returnedBytes + ' bytes' + (body.truncated ? ', truncated' : '')
    const committed =
      root.getAttribute('data-preview-provenance') === 'private-shadow'
        ? 'Committed in this private shadow.'
        : 'Committed in this synthetic snapshot.'
    return place + '.' + project + ' ' + size + '. ' + committed
  }
  let selection = 0
  let activeFetch = null
  const tokenPattern = /^[A-Za-z0-9_-]{1,684}$/
  const corpusStatus = document.querySelector('#corpus-status')
  const groupName = (path) => {
    if (path === 'Core.md' || path === 'index.md' || path === 'system/persona.md') return 'baseline'
    if (path.indexOf('human/') === 0 || path.indexOf('system/human/') === 0) return 'human'
    if (path.indexOf('projects/') === 0) return 'project'
    if (path.indexOf('reference/') === 0) return 'reference'
    return 'library'
  }
  const groupLabel = {
    baseline: 'Baseline',
    human: 'Human',
    project: 'Project',
    reference: 'Reference',
    library: 'Other library',
  }
  const treeHost = (group) => {
    const name = group === 'baseline' ? 'core' : 'external'
    return browser.querySelector('[data-tree="' + name + '"]') || browser
  }
  const ensureList = (group) => {
    const selector = 'ul[data-group="' + group + '"]'
    const existing = browser.querySelector(selector)
    if (existing) return existing
    const section = document.createElement('section')
    section.setAttribute('data-memory-group', group)
    const heading = document.createElement('h3')
    heading.className = 'group-heading'
    heading.textContent = (groupLabel[group] || group) + ' '
    addText(heading, 'span', '').setAttribute('data-group-count', '')
    const list = document.createElement('ul')
    list.className = 'file-list'
    list.setAttribute('data-group', group)
    section.append(heading)
    section.append(list)
    treeHost(group).append(section)
    return list
  }
  const appendEntry = (entry) => {
    if (!entry || typeof entry.path !== 'string' || entry.path.indexOf('\0') !== -1) return false
    if (typeof entry.token !== 'string' || !tokenPattern.test(entry.token)) return false
    let list = ensureList(groupName(entry.path))
    const parts = entry.path.split('/')
    let prefix = ''
    for (const part of parts.slice(0, -1)) {
      prefix += part + '/'
      let folder = Array.from(list.children).find((item) => item.getAttribute('data-folder-path') === prefix)
      if (!folder) {
        folder = document.createElement('li')
        folder.setAttribute('data-folder-path', prefix)
        const disclosure = document.createElement('details')
        disclosure.setAttribute('data-folder', prefix)
        disclosure.open = true
        const summary = addText(disclosure, 'summary', '')
        summary.setAttribute('aria-label', prefix)
        const folderName = document.createElement('span')
        folderName.className = 'folder-name'
        folderName.textContent = part + '/'
        const folderCount = document.createElement('span')
        folderCount.className = 'folder-count quiet'
        folderCount.setAttribute('data-folder-count', '')
        summary.append(folderName)
        summary.append(folderCount)
        const children = document.createElement('ul')
        children.className = 'file-list'
        children.setAttribute('role', 'list')
        disclosure.append(children)
        folder.append(disclosure)
        list.append(folder)
      }
      list = folder.querySelector('ul')
    }
    const item = document.createElement('li')
    item.setAttribute('data-path', entry.path)
    const meta = document.createElement('span')
    meta.className = 'file-meta'
    meta.textContent = entry.bytes === null ? 'size unavailable' : entry.bytes + ' bytes'
    if (entry.kind !== 'file') {
      const label = document.createElement('span')
      label.className = 'file-static'
      label.textContent = entry.path
      item.append(label)
      item.append(document.createTextNode(' '))
      item.append(meta)
    } else {
      const link = document.createElement('a')
      link.className = 'file-link'
      const documentUrl = documentPrefix + entry.token
      const href = readPrefix + entry.token
      link.setAttribute('href', href)
      link.setAttribute('data-path', entry.path)
      link.setAttribute('data-document', documentUrl)
      if (entry.path === selectedPath) link.setAttribute('aria-current', 'page')
      const pathText = document.createElement('span')
      pathText.className = 'file-path'
      pathText.textContent = parts[parts.length - 1]
      const size = document.createElement('span')
      size.className = 'file-size'
      size.textContent = typeof entry.bytes === 'number' ? String(entry.bytes) : ''
      link.setAttribute('aria-label', entry.path)
      link.append(pathText)
      link.append(size)
      link.append(meta)
      item.append(link)
    }
    list.append(item)
    return true
  }
  const pageOk = (body, offset) => {
    if (!body || body.version !== 1 || body.commit !== commit || body.offset !== offset) return false
    const corpusTotal = Number(root.getAttribute('data-corpus-total') || '0')
    if (body.total !== corpusTotal || !Array.isArray(body.entries) || body.returned !== body.entries.length) return false
    if (body.returned < 1 || body.returned > 32 || typeof body.truncated !== 'boolean') return false
    if (body.text || body.summary || body.stateRoot || body.worktreePath) return false
    let previous = ''
    for (const entry of body.entries) {
      if (!entry || typeof entry.path !== 'string' || typeof entry.token !== 'string') return false
      if (!tokenPattern.test(entry.token) || entry.text || entry.summary) return false
      if (previous && previous >= entry.path) return false
      previous = entry.path
    }
    return true
  }
  let corpusLoading = false
  const loadCorpus = async () => {
    if (root.getAttribute('data-corpus-truncated') !== 'true' || !corpusStatus) return
    if (corpusLoading) return
    corpusLoading = true
    if (loadMore) loadMore.disabled = true
    try {
    const corpusTotal = Number(root.getAttribute('data-corpus-total') || '0')
    const offset = Number(root.getAttribute('data-corpus-returned') || '0')
    if (!Number.isSafeInteger(corpusTotal) || !Number.isSafeInteger(offset) || corpusTotal < 0) return
    const seen = new Set(rows().map((row) => row.getAttribute('data-path')))
    corpusStatus.textContent = 'Loading one page of memory files.'
    {
      let response
      try {
        response = await fetch(corpusRoot + '/' + String(offset), {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
        })
      } catch {
        corpusStatus.textContent = 'That page could not be loaded. Use Load more files to try again.'
        return
      }
      if (!response.ok) {
        corpusStatus.textContent = 'That page could not be loaded. Use Load more files to try again.'
        return
      }
      const raw = await response.text()
      if (raw.length > 49152) {
        corpusStatus.textContent = 'That page could not be loaded. Use Load more files to try again.'
        return
      }
      let body
      try {
        body = JSON.parse(raw)
      } catch {
        corpusStatus.textContent = 'That page could not be loaded. Use Load more files to try again.'
        return
      }
      if (!pageOk(body, offset)) {
        corpusStatus.textContent = 'That page could not be loaded. Use Load more files to try again.'
        return
      }
      for (const entry of body.entries) {
        if (seen.has(entry.path) || appendEntry(entry) !== true) {
          corpusStatus.textContent = 'That page could not be loaded. Use Load more files to try again.'
          return
        }
        seen.add(entry.path)
      }
      const next = body.offset + body.returned
      if (next <= offset) {
        corpusStatus.textContent = 'That page could not be loaded. Use Load more files to try again.'
        return
      }
      root.setAttribute('data-corpus-returned', String(next))
      root.setAttribute('data-corpus-truncated', String(body.truncated))
      if (loadMore) loadMore.hidden = !body.truncated
    }
    applyFilter()
    const note = document.querySelector('#corpus-note')
    if (note) note.textContent = 'Showing ' + seen.size + ' of ' + corpusTotal + ' corpus entries.'
    if (seen.size === corpusTotal)
      corpusStatus.textContent = 'Showing ' + seen.size + ' of ' + corpusTotal + ' corpus entries.'
    else corpusStatus.textContent = 'One page loaded. More files are available.'
    } finally {
      corpusLoading = false
      if (loadMore) loadMore.disabled = false
    }
  }
  const openFile = async (path, documentUrl, href) => {
    selection += 1
    const generation = selection
    if (activeFetch) activeFetch.abort()
    const controller = new AbortController()
    activeFetch = controller
    const current = () => generation === selection
    status.textContent = 'Loading the selected memory file.'
    try {
      const token = documentUrl && documentUrl.indexOf(documentPrefix) === 0 ? documentUrl.slice(documentPrefix.length) : ''
      if (!tokenPattern.test(token) || documentUrl !== documentPrefix + token) {
        if (current()) status.textContent = 'That memory file is not available in this snapshot.'
        return
      }
      const response = await fetch(documentUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
      })
      if (!current()) return
      if (!response.ok) {
        if (current()) status.textContent = 'That memory file is not available in this snapshot.'
        return
      }
      const body = await response.json()
      if (!current()) return
      const bytes = typeof body.text === 'string' ? new TextEncoder().encode(body.text).length : -1
      if (
        !body ||
        body.commit !== commit ||
        body.path !== path ||
        typeof body.text !== 'string' ||
        body.text.indexOf('\0') !== -1 ||
        bytes !== body.returnedBytes ||
        bytes > 12288
      ) {
        if (current()) status.textContent = 'That memory file is not available in this snapshot.'
        return
      }
      if (!current()) return
      title.textContent = body.path
      meta.textContent = metaText(body)
      const readerStatus = document.querySelector('#reader-status')
      const readerMessage = document.querySelector('#reader-message')
      if (readerStatus)
        readerStatus.textContent = body.returnedBytes + ' bytes' + (body.truncated ? ' truncated' : '')
      if (readerMessage)
        readerMessage.textContent = body.placement === 'baseline' ? 'Baseline prompt' : 'On-demand library'
      clear(raw)
      addText(raw, 'code', body.text)
      render(body.text)
      select(path)
      if (href && current()) history.replaceState(null, '', href)
      if (current()) status.textContent = 'Showing the selected memory file.'
    } catch (error) {
      if (!current()) return
      if (error && error.name === 'AbortError') return
      status.textContent = 'That memory file could not be loaded. Reload the page to try again.'
    }
  }
  filter.addEventListener('input', applyFilter)
  filter.addEventListener('search', applyFilter)
  browser.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('a[data-path]') : null
    if (!target) return
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const path = target.getAttribute('data-path')
    const href = target.getAttribute('href')
    const documentUrl = target.getAttribute('data-document')
    if (!path || !href || !documentUrl) return
    event.preventDefault()
    openFile(path, documentUrl, href)
  })
  const linkShown = (link, boundary) => {
    let node = link
    while (node && node !== boundary) {
      if (node.hidden || (node.tagName === 'DETAILS' && !node.open)) return false
      node = node.parentElement
    }
    return true
  }
  browser.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const visible = links().filter((link) => linkShown(link, browser))
    const index = visible.indexOf(document.activeElement)
    const step = event.key === 'ArrowDown' ? index + 1 : index - 1
    const choice = visible[step] || visible[event.key === 'ArrowDown' ? 0 : visible.length - 1]
    if (!choice) return
    event.preventDefault()
    choice.focus()
  })
  raw.hidden = true
  if (loadMore) loadMore.addEventListener('click', loadCorpus)
  for (const mode of document.querySelectorAll('[data-format]')) {
    mode.addEventListener('click', () => {
      const isRaw = mode.getAttribute('data-format') === 'raw'
      rendered.hidden = isRaw
      raw.hidden = !isRaw
      for (const control of document.querySelectorAll('[data-format]'))
        control.setAttribute('aria-pressed', String(control === mode))
    })
  }
  const views = Array.from(document.querySelectorAll('[data-view]'))
  const viewForPath = (path) =>
    path === 'Core.md' || path === 'index.md' || path === 'system/persona.md' ? 'core' : 'external'
  const showView = (name) => {
    const hide = (id, hidden) => {
      const panel = document.querySelector('#' + id)
      if (panel) panel.hidden = hidden
    }
    hide('context', name !== 'context')
    hide('memory', name !== 'core' && name !== 'external')
    hide('history', name !== 'history')
    const coreTree = browser.querySelector('[data-tree="core"]')
    const externalTree = browser.querySelector('[data-tree="external"]')
    if (coreTree) coreTree.hidden = name !== 'core'
    if (externalTree) externalTree.hidden = name !== 'external'
    const filesTitle = document.querySelector('#files-title')
    if (filesTitle && name === 'core') filesTitle.textContent = 'Baseline memory'
    if (filesTitle && name === 'external') filesTitle.textContent = 'On-demand library'
    for (const view of views) {
      if (view.getAttribute('data-view') === name) view.setAttribute('aria-current', 'page')
      else view.removeAttribute('aria-current')
    }
  }
  const firstLoadedFile = (treeName) => {
    const tree = browser.querySelector('[data-tree="' + treeName + '"]')
    if (!tree) return null
    for (const link of tree.querySelectorAll('a[data-path]')) {
      if (linkShown(link, browser)) return link
    }
    return null
  }
  const clearReader = () => {
    selectedPath = ''
    title.textContent = 'Memory file'
    meta.textContent = 'No memory file is loaded in this view.'
    const readerStatus = document.querySelector('#reader-status')
    const readerMessage = document.querySelector('#reader-message')
    if (readerStatus) readerStatus.textContent = 'No file loaded'
    if (readerMessage) readerMessage.textContent = 'Select a memory file'
    clear(rendered)
    clear(raw)
    for (const link of links()) link.removeAttribute('aria-current')
  }
  for (const view of views) view.addEventListener('click', (event) => {
    event.preventDefault()
    const name = view.getAttribute('data-view')
    selection += 1
    if (activeFetch) activeFetch.abort()
    activeFetch = null
    showView(name)
    if (name !== 'core' && name !== 'external') return
    if (selectedPath && viewForPath(selectedPath) === name) return
    const link = firstLoadedFile(name)
    const path = link ? link.getAttribute('data-path') : ''
    const href = link ? link.getAttribute('href') : ''
    const documentUrl = link ? link.getAttribute('data-document') : ''
    clearReader()
    if (path && href && documentUrl) openFile(path, documentUrl, href)
  })
  const historyFilter = document.querySelector('#history-filter')
  const historyKind = document.querySelector('#history-kind')
  const historyCount = document.querySelector('#history-count')
  const historyEmpty = document.querySelector('#history-empty')
  const historyList = document.querySelector('#history-list')
  const applyHistory = () => {
    if (!historyFilter || !historyList || !historyCount) return
    const query = historyFilter.value.trim().toLowerCase()
    const kind = historyKind ? historyKind.value : 'all'
    const cards = Array.from(historyList.querySelectorAll('[data-history-card]'))
    let shown = 0
    for (const card of cards) {
      const text = (card.getAttribute('data-history-text') || '').toLowerCase()
      const cardKind = card.getAttribute('data-history-kind') || ''
      const visible = (kind === 'all' || kind === cardKind) && (!query || text.indexOf(query) !== -1)
      card.hidden = !visible
      if (visible) shown += 1
    }
    historyCount.textContent = shown + ' shown / ' + cards.length + ' loaded records'
    if (historyEmpty) historyEmpty.hidden = shown > 0 || cards.length === 0
  }
  if (historyFilter) {
    historyFilter.addEventListener('input', applyHistory)
    historyFilter.addEventListener('search', applyHistory)
  }
  if (historyKind) historyKind.addEventListener('change', applyHistory)
  const requestedOpen = root.getAttribute('data-palace-open') || ''
  const opening =
    requestedOpen === 'context' || requestedOpen === 'core' || requestedOpen === 'external' || requestedOpen === 'history'
      ? requestedOpen
      : selectedPath
        ? viewForPath(selectedPath)
        : 'context'
  showView(opening)
  applyFilter()
  applyHistory()
})()`
}

function statusHtml(status: LocalJobStatus): string {
  const label = statusLabel[status]
  const mark = statusMark[status]
  return `<span class="status" data-status="${status}"><span class="mark" aria-hidden="true" data-status="${status}">${mark}</span> ${label}</span>`
}

function fileRow(
  entry: PalaceSnapshot['corpus']['entries'][number],
  reloadPath: string,
  head: string,
  current: string | null,
): string {
  const placed = palaceMemoryPlacement(entry.path)
  const selected = entry.path === current
  const bytes = entry.bytes === null ? 'size unavailable' : `${entry.bytes} bytes`
  const project = placed.group === 'project' ? ' Not automatic context.' : ''
  const meta =
    entry.kind === 'file'
      ? `${placed.label}. ${bytes}.${project}${selected ? ' Selected.' : ''}`
      : `${entry.kind}. Not opened as a document.`
  const path = escapePalaceText(entry.path)
  const name = escapePalaceText(entry.path.split('/').at(-1) ?? entry.path)
  const size = entry.bytes === null ? '' : String(entry.bytes)
  if (entry.kind !== 'file') {
    return `<li data-path="${path}"><span class="file-static">${path}</span> <span class="file-meta">${escapePalaceText(meta)}</span></li>`
  }
  const token = encodePalacePath(entry.path)
  const href = escapePalaceText(`${reloadPath}/read/${head}/${token}`)
  const documentUrl = escapePalaceText(`${reloadPath}/document/${head}/${token}`)
  const currentAttr = selected ? ' aria-current="page"' : ''
  return `<li data-path="${path}"><a class="file-link" aria-label="${path}" href="${href}" data-path="${path}" data-document="${documentUrl}"${currentAttr}><span class="file-path">${name}</span><span class="file-size">${size}</span><span class="file-meta">${escapePalaceText(meta)}</span></a></li>`
}

function groupedList(
  group: keyof typeof groupTitle,
  entries: PalaceSnapshot['corpus']['entries'],
  reloadPath: string,
  head: string,
  current: string | null,
): string {
  if (!entries.length) return ''
  const tree = (paths: typeof entries, depth: number, prefix: string): string => {
    const folders = new Map<string, typeof entries>()
    const files: typeof entries = []
    for (const entry of paths) {
      const parts = entry.path.split('/')
      if (parts.length <= depth + 1) files.push(entry)
      else {
        const name = parts[depth]!
        const children = folders.get(name) ?? []
        children.push(entry)
        folders.set(name, children)
      }
    }
    return (
      [...folders]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([name, children]) => {
          const path = `${prefix}${name}/`
          return `<li data-folder-path="${escapePalaceText(path)}"><details data-folder="${escapePalaceText(path)}" open><summary aria-label="${escapePalaceText(path)}"><span class="folder-name">${escapePalaceText(name)}/</span><span class="folder-count quiet" data-folder-count>(${children.length})</span></summary><ul class="file-list" role="list">${tree(children, depth + 1, path)}</ul></details></li>`
        })
        .join('') + files.map((entry) => fileRow(entry, reloadPath, head, current)).join('')
    )
  }
  return `<section data-memory-group="${group}"><h3 class="group-heading">${escapePalaceText(groupTitle[group])} <span data-group-count>(${entries.length})</span></h3><ul class="file-list" role="list" data-group="${group}">${tree(entries, 0, '')}</ul></section>`
}

function browserHtml(
  snapshot: PalaceSnapshot,
  reloadPath: string,
  current: string | null,
  filesTitle: string,
): string {
  const groups: Record<keyof typeof groupTitle, PalaceSnapshot['corpus']['entries']> = {
    baseline: [],
    human: [],
    project: [],
    reference: [],
    library: [],
  }
  for (const entry of snapshot.corpus.entries) {
    groups[palaceMemoryPlacement(entry.path).group].push(entry)
  }
  const fileCount = snapshot.corpus.entries.filter((entry) => entry.kind === 'file').length
  const fileLabel = fileCount === 1 ? '1 file' : `${fileCount} files`
  const coreTree =
    groupedList('baseline', groups.baseline, reloadPath, snapshot.head, current) ||
    '<p>No baseline files are loaded in this page.</p>'
  const externalTree =
    (['human', 'project', 'reference', 'library'] as const)
      .map((group) => groupedList(group, groups[group], reloadPath, snapshot.head, current))
      .join('') || '<p>No library files are loaded in this page.</p>'
  const loadedPaths = new Set(snapshot.corpus.entries.map((entry) => entry.path))
  const missing = [
    snapshot.corpus.corePresent && !loadedPaths.has('Core.md') ? 'Core.md' : '',
    snapshot.corpus.indexPresent && !loadedPaths.has('index.md') ? 'index.md' : '',
  ].filter(Boolean)
  const presence = missing.length
    ? `<p class="quiet">Present in this corpus but not on the loaded page: ${missing.map((path) => escapePalaceText(path)).join(', ')}.</p>`
    : ''
  const truncated = snapshot.corpus.truncated
    ? `<p id="corpus-note">Showing ${snapshot.corpus.returned} of ${snapshot.corpus.total} corpus entries. Load one page at a time.</p>`
    : ''
  const empty =
    snapshot.corpus.entries.length === 0 ? '<p>No committed memory files are in this snapshot.</p>' : ''
  return `<aside class="panel tree-panel" aria-labelledby="files-title"><h2 id="files-title" class="tree-desc">${escapePalaceText(filesTitle)}</h2><search><label for="memory-filter">Filter loaded files by path</label><input id="memory-filter" type="search" aria-describedby="memory-count"><p id="memory-count" class="history-search-status" role="status">${fileLabel} loaded / ${snapshot.corpus.total} total entries</p></search>${truncated}<p id="corpus-status" aria-live="polite"></p><div id="memory-browser"><div data-tree="core">${coreTree}${presence}</div><div data-tree="external">${externalTree}</div>${empty}</div><p id="filter-empty" hidden>No loaded files match. Clear the filter or load more files.</p><button id="load-more" type="button"${snapshot.corpus.truncated ? '' : ' hidden'}>Load more files</button></aside>`
}

function committedCopy(provenance: PalacePreviewProvenance): string {
  return provenance === 'private-shadow'
    ? 'Committed in this private shadow.'
    : 'Committed in this synthetic snapshot.'
}

function readerHtml(
  document: PalaceDocument | null,
  head: string,
  provenance: PalacePreviewProvenance,
): string {
  const text = document?.text ?? ''
  const title = document ? escapePalaceText(document.path) : 'Memory file'
  const placed = document ? palaceMemoryPlacement(document.path) : null
  const project = placed?.group === 'project' ? ' Project notes are not automatic context.' : ''
  const meta = document
    ? `${placed?.label}.${project} ${document.returnedBytes} bytes${document.truncated ? ', truncated' : ''}. ${committedCopy(provenance)}`
    : 'No memory file is loaded in this view.'
  const rendered = document ? renderPalaceMarkdown(text) : ''
  const status = document
    ? `${document.returnedBytes} bytes${document.truncated ? ' truncated' : ''}`
    : 'No file loaded'
  const message = placed?.label ?? 'Select a memory file'
  return `<article class="panel file-panel" aria-labelledby="document-title"><div class="file-last-commit"><code class="lc-hash">${escapePalaceText(head.slice(0, 7))}</code><span id="reader-message" class="lc-msg">${escapePalaceText(message)}</span><span class="lc-meta"><span id="reader-status">${escapePalaceText(status)}</span> Not live authority</span></div><div class="file-meta"><h2 id="document-title" class="file-path">${title}</h2><div class="meta-row"><p class="meta-pill"><strong>description:</strong> <span id="document-meta">${escapePalaceText(meta)}</span></p><div class="format-controls" role="group" aria-label="Document format"><button class="raw-toggle" type="button" data-format="rendered" aria-pressed="true" aria-controls="document-rendered">Rendered</button><button class="raw-toggle" type="button" data-format="raw" aria-pressed="false" aria-controls="document-raw">Raw</button></div></div></div><div id="document-rendered" class="file-body">${rendered}</div><pre id="document-raw" class="file-body-raw" tabindex="0"><code>${escapePalaceText(text)}</code></pre><p id="document-status" aria-live="polite"></p></article>`
}

function recoveryNote(snapshot: PalaceSnapshot): string {
  if (snapshot.recovery.phase === 'interrupted') {
    return '<p class="ctx-note">Coordinator recovery stopped before detached work was finished. This preview does not resume it.</p>'
  }
  if (snapshot.recovery.phase === 'settled') {
    return '<p class="ctx-note">Coordinator recovery settled detached work before this snapshot. This preview did not publish.</p>'
  }
  return ''
}

type PalaceView = 'context' | 'core' | 'external' | 'history'

function loadedFiles(snapshot: PalaceSnapshot, core: boolean): number {
  return snapshot.corpus.entries.filter((entry) => {
    if (entry.kind !== 'file') return false
    const baseline = palaceMemoryPlacement(entry.path).placement === 'baseline'
    return core ? baseline : !baseline
  }).length
}

function tabCountLabel(loaded: number, truncated: boolean): string {
  return truncated ? `${loaded} loaded` : String(loaded)
}

const contextBlockCount = 480
const contextKeys = [...palaceContextBreakdownKeys, 'unattributed', 'free'] as const
type ContextKey = (typeof contextKeys)[number]
const contextLabel: Record<ContextKey, string> = {
  system: 'System',
  core: 'Core memory',
  external: 'External memory',
  summary: 'Summary',
  tools: 'Tools',
  messages: 'Messages',
  unattributed: 'Unattributed',
  free: 'Free',
}
const contextSymbol: Record<ContextKey, string> = {
  system: '\u25C9',
  core: '\u25C9',
  external: '\u25CF',
  summary: '\u29BB',
  tools: '\u25CF',
  messages: '\u25CF',
  unattributed: '\u25CB',
  free: '\u25A1',
}

function contextCoverageCss(): string {
  const fills = Array.from({ length: 101 }, (_, step) => `.ctx-fill-${step} { inline-size: ${step}%; }`).join(
    '\n',
  )
  const hover = contextKeys
    .map(
      (key) => `
    .context-grid:has([data-cat="${key}"]:hover) [data-cat="${key}"] { opacity: 1; filter: brightness(1.8); transform: scale(1.3); }
    .context-grid:has([data-cat="${key}"]:hover) .block:not([data-cat="${key}"]) { opacity: 0.15; }
    .context-layout:has(.context-grid [data-cat="${key}"]:hover) .ctx-legend-item:not([data-legend="${key}"]) { opacity: 0.25; }`,
    )
    .join('\n')
  return `${fills}\n${hover}`
}

function allocateContextBlocks(counts: number[]): number[] {
  const total = counts.reduce((sum, count) => sum + count, 0)
  if (total <= 0) return counts.map(() => 0)
  const rows = counts.map((count) => {
    const exact = (count / total) * contextBlockCount
    return { count, floor: Math.floor(exact), frac: exact - Math.floor(exact) }
  })
  const blocks = rows.map((row) => row.floor)
  let left = contextBlockCount - blocks.reduce((sum, count) => sum + count, 0)
  const order = rows
    .map((row, index) => ({ index, frac: row.frac, count: row.count }))
    .sort(
      (leftRow, rightRow) =>
        rightRow.frac - leftRow.frac || rightRow.count - leftRow.count || leftRow.index - rightRow.index,
    )
  for (const slot of order) {
    if (left <= 0) break
    blocks[slot.index] += 1
    left -= 1
  }
  for (let index = 0; index < blocks.length; index += 1) {
    if (counts[index] <= 0 || blocks[index] > 0) continue
    const donor = blocks.findIndex((value, donorIndex) => donorIndex !== index && value > 1)
    if (donor < 0) break
    blocks[donor] -= 1
    blocks[index] = 1
  }
  return blocks
}

function qualityWord(quality: PalaceContextQuality): string {
  return quality === 'estimated' ? 'Estimated' : 'Owner-supplied'
}

function contextCounts(context: PalaceContextSnapshot): Record<ContextKey, number> {
  const counts = {
    unattributed: context.usage.usedTokens,
    free: context.usage.contextWindow - context.usage.usedTokens,
  } as Record<ContextKey, number>
  for (const key of palaceContextBreakdownKeys) {
    counts[key] = context.breakdown[key]
    counts.unattributed -= context.breakdown[key]
  }
  return counts
}

function contextLegend(key: ContextKey, count: number, window: number): string {
  const share = ((count / window) * 100).toFixed(1)
  const value = `<span class="ctx-legend-value">${count} (${share}%)</span>`
  const symbol = `<span class="ctx-legend-sym ctx-${key}" aria-hidden="true">${contextSymbol[key]}</span>`
  const name = `<span class="ctx-legend-name">${escapePalaceText(contextLabel[key])}</span>`
  const view = key === 'core' ? 'core' : key === 'external' ? 'external' : null
  if (!view) return `<div class="ctx-legend-item" data-legend="${key}">${symbol}${name}${value}</div>`
  const arrow = '<span class="ctx-legend-arrow" aria-hidden="true">\u2192</span>'
  return `<button type="button" class="ctx-legend-item" data-legend="${key}" data-view="${view}">${symbol}${name}${arrow}${value}</button>`
}

function contextHtml(context: PalaceContextSnapshot | null, recovery: string): string {
  const authority = `<p class="ctx-note">ABI2 remains live authority. This preview does not publish.</p>${recovery}`
  if (!context) {
    return `<section id="context"><p>Session context snapshot unavailable. This preview was not opened from an active Pi command.</p>${authority}</section>`
  }
  const counts = contextCounts(context)
  const window = context.usage.contextWindow
  const blocks =
    context.usage.usedTokens === 0
      ? contextKeys.map((key) => (key === 'free' ? contextBlockCount : 0))
      : allocateContextBlocks(contextKeys.map((key) => counts[key]))
  const grid = contextKeys
    .flatMap((key, index) =>
      Array.from(
        { length: blocks[index] ?? 0 },
        () => `<span class="block ctx-${key}" data-cat="${key}">${contextSymbol[key]}</span>`,
      ),
    )
    .join('')
  const legend = contextKeys
    .filter((key) => counts[key] > 0)
    .map((key) => contextLegend(key, counts[key], window))
    .join('')
  const described = contextKeys
    .filter((key) => counts[key] > 0)
    .map((key) => `${contextLabel[key]} ${counts[key]}`)
  const quality = qualityWord(context.usage.quality).toLowerCase()
  const summary = `Context grid of ${contextBlockCount} blocks for ${context.usage.usedTokens} of ${window} ${quality} tokens. ${described.join(', ')}.`
  const subtitle =
    context.capture === 'preview-fixture'
      ? 'Preview fixture · Not a live session'
      : `Invocation snapshot · ${qualityWord(context.usage.quality)} context usage`
  const model = context.model
    ? `<p class="ctx-model">${escapePalaceText(context.model.provider ? `${context.model.provider} · ${context.model.id}` : context.model.id)}</p>`
    : ''
  const remaining = context.usage.usedTokens === 0 ? 'No tokens are in use.' : `${counts.free} tokens free`
  const legendTitle = `${qualityWord(context.breakdown.quality)} context composition`
  return `<section id="context"><div class="context-layout"><div class="context-grid-area"><p class="ctx-summary">${escapePalaceText(summary)}</p><div class="context-grid" aria-hidden="true">${grid}</div></div><aside class="context-sidebar">${model}<p class="ctx-model-sub">${escapePalaceText(subtitle)}</p><p class="ctx-usage-label">${context.usage.usedTokens}/${window} ${quality} tokens (${context.usage.percent}%)</p><div class="ctx-bar-track"><div class="ctx-bar-fill ctx-fill-${context.usage.percent}"></div></div><p class="ctx-bar-text">${escapePalaceText(remaining)}</p><p class="ctx-legend-title">${escapePalaceText(legendTitle)}</p>${legend}${authority}</aside></div></section>`
}

function historyCard(kind: string, text: string, body: string): string {
  return `<article class="commit-item" data-history-card data-history-kind="${kind}" data-history-text="${escapePalaceText(text)}"><div class="commit-head">${body}</div></article>`
}

function historyHtml(snapshot: PalaceSnapshot): string {
  const jobs = [...snapshot.jobs.entries].sort((left, right) => right.sequence - left.sequence)
  const cards = [
    ...jobs.map((job) =>
      historyCard(
        'job',
        `${job.id} ${job.kind} ${job.status} ${statusLabel[job.status]} ${guidanceCopy[job.guidance]}`,
        `<code class="commit-hash">${escapePalaceText(job.id)}</code><div class="commit-center"><p class="commit-title">${escapePalaceText(job.kind)}</p><p class="commit-preview">${escapePalaceText(guidanceCopy[job.guidance])}</p></div><div class="commit-meta">${statusHtml(job.status)}<span>sequence ${job.sequence}</span></div>`,
      ),
    ),
    ...snapshot.publication.pending.map((entry) =>
      historyCard(
        'publication',
        `${entry.jobId} pending publication ${entry.commit} ${entry.expectedParent}`,
        `<code class="commit-hash">${escapePalaceText(entry.commit.slice(0, 7))}</code><div class="commit-center"><p class="commit-title">Pending publication</p><p class="commit-preview"><code>${escapePalaceText(entry.jobId)}</code></p></div><div class="commit-meta"><span>sequence ${entry.sequence}</span><span>Not live authority</span></div>`,
      ),
    ),
    ...snapshot.history.detached.map((entry) => {
      const role = entry.role === 'detached-commit' ? 'Detached job commit' : 'Detached worktree'
      const oid = entry.oid === null ? 'None' : entry.oid
      return historyCard(
        'detached',
        `${entry.jobId} ${role} ${oid}`,
        `<code class="commit-hash">${escapePalaceText(entry.oid === null ? 'none' : entry.oid.slice(0, 7))}</code><div class="commit-center"><p class="commit-title">${role}</p><p class="commit-preview"><code>${escapePalaceText(entry.jobId)}</code></p></div><div class="commit-meta"><span>sequence ${entry.sequence}</span><span>Not live authority</span></div>`,
      )
    }),
  ]
  const list = cards.join('') || '<p>No recent maintenance activity is in this snapshot.</p>'
  const scope = `Jobs ${snapshot.jobs.returned} of ${snapshot.jobs.total}${snapshot.jobs.truncated ? ', more jobs are outside this page' : ''}. Integrated ${snapshot.publication.integrated}. Pending publication ${snapshot.publication.pendingReturned} of ${snapshot.publication.pendingTotal}. Detached work ${snapshot.history.detachedReturned} of ${snapshot.history.detachedTotal}. This is not Git commit history.`
  return `<section id="history"><h2 class="tree-desc">Knowledge history</h2><p class="note">Unavailable in this per-request HTML preview. The disconnected service has a separately captured, committed knowledge-history API; this page does not collect an installed invocation or expose a history/diff route.</p><h2 class="tree-desc">Lifecycle history</h2><p class="note">Retry and resume are read-only here. There are no mutation controls; reads may reconcile or recover under the service owner.</p><search class="history-toolbar"><div class="history-search-group"><label class="history-field" for="history-filter">Search loaded activity<input id="history-filter" class="history-search-input" type="search" aria-describedby="history-count"></label><label class="history-field history-field-activity" for="history-kind">Activity<select id="history-kind" class="history-search-select"><option value="all">All loaded records</option><option value="job">Jobs</option><option value="publication">Publication</option><option value="detached">Detached work</option></select></label></div><p id="history-count" class="history-search-status" role="status">${cards.length} shown / ${cards.length} loaded records</p></search><p class="note">${escapePalaceText(scope)}</p><div id="history-list" class="commit-list">${list}</div><p id="history-empty" class="empty" hidden>No loaded records match. Clear the search or choose another activity.</p>${repairHtml(snapshot)}${diagnosticsHtml(snapshot)}</section>`
}

function viewLinks(current: PalaceView, coreLabel: string, externalLabel: string): string {
  const item = (view: PalaceView, href: string, label: string) =>
    `<li><a class="tab" href="${href}" data-view="${view}"${view === current ? ' aria-current="page"' : ''}>${label}</a></li>`
  return [
    item('context', '#context', 'Context'),
    item('core', '#core', `Core memory (<span data-tab-count="core">${coreLabel}</span>)`),
    item(
      'external',
      '#external',
      `External memory (<span data-tab-count="external">${externalLabel}</span>)`,
    ),
    item('history', '#history', 'History'),
  ].join('')
}

function repairHtml(snapshot: PalaceSnapshot): string {
  const repairs = snapshot.jobs.entries.filter((job) => job.status === 'repair-needed')
  if (!repairs.length && snapshot.conflicts.total === 0 && snapshot.conflicts.hidden === 0) return ''
  const coverage = repairs.length
    ? ''
    : '<p>The repair job is outside the current bounded activity page, but conflict evidence remains visible.</p>'
  const paths = snapshot.conflicts.entries.map(
    (entry) => `<li><code>${escapePalaceText(entry.path)}</code></li>`,
  )
  const hidden =
    snapshot.conflicts.hidden > 0
      ? `<p>Forgotten conflict paths stay omitted. Hidden count: ${snapshot.conflicts.hidden}.</p>`
      : ''
  const listed = paths.length
    ? `<ul>${paths.join('')}</ul>`
    : '<p>No visible conflict path is listed in this page.</p>'
  const truncated = snapshot.conflicts.truncated
    ? '<p>Not every visible conflict path fits in this page.</p>'
    : ''
  return `<section><h3>Conflict evidence</h3>${coverage}<p>${escapePalaceText(guidanceCopy['retry-blocked'])}</p><p>Resume and retry never repair conflicts. Explicit repair or abandonment is available only through the synthetic coordinator, not this preview. Terminal jobs retain historical conflicts. This preview does not show a conflict diff or a job body.</p>${listed}${hidden}${truncated}</section>`
}

function diagnosticsHtml(snapshot: PalaceSnapshot): string {
  const head = [
    '<tr><th scope="row">refs/heads/main</th><td>Canonical main</td><td>',
    escapePalaceText(snapshot.history.canonicalCommit),
    '</td></tr>',
  ].join('')
  const detached = snapshot.history.detached
    .map((entry) => {
      const role = entry.role === 'detached-commit' ? 'Detached job commit' : 'Detached worktree'
      const oid = entry.oid === null ? 'None' : escapePalaceText(entry.oid)
      return `<tr><th scope="row">${escapePalaceText(entry.jobId)}</th><td>${role}</td><td>${oid}</td></tr>`
    })
    .join('')
  const legend = localJobStatuses
    .map((status) => `<li>${statusHtml(status)} <code>${status}</code></li>`)
    .join('')
  const guidance = (Object.keys(guidanceCopy) as PalaceGuidance[])
    .map((code) => `<li><code>${escapePalaceText(code)}</code> ${escapePalaceText(guidanceCopy[code])}</li>`)
    .join('')
  return `<details><summary>Diagnostics</summary><h3>Canonical commit and detached work</h3><p>Detached job work is not a Git branch. It is unpublished job state, not Git commit history.</p><div class="table-wrapper" tabindex="0" role="region" aria-labelledby="detached-caption"><table><caption id="detached-caption">Detached work. Showing ${snapshot.history.detachedReturned} of ${snapshot.history.detachedTotal}${snapshot.history.detachedTruncated ? ', truncated' : ''}.</caption><thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Commit</th></tr></thead><tbody>${head}${detached}</tbody></table></div><h3>Counts</h3><dl><dt>Snapshot bytes</dt><dd>${snapshot.bytes}</dd><dt>Forgetting phase</dt><dd>${escapePalaceText(snapshot.publication.forgettingPhase)}</dd><dt>Forgetting revision</dt><dd>${snapshot.publication.forgettingRevision}</dd><dt>Forgotten paths</dt><dd>${snapshot.publication.forgottenPaths}</dd><dt>Forgotten blobs</dt><dd>${snapshot.publication.forgottenBlobs}</dd><dt>Forgotten sources</dt><dd>${snapshot.publication.forgottenSources}</dd><dt>Integrated jobs</dt><dd>${snapshot.publication.integrated}</dd><dt>Pending publication</dt><dd>${snapshot.publication.pendingReturned} of ${snapshot.publication.pendingTotal}</dd><dt>Hidden conflicts</dt><dd>${snapshot.conflicts.hidden}</dd></dl><h3>Lifecycle codes</h3><ul>${legend}</ul><ul>${guidance}</ul></details>`
}

function openedView(selected: PalaceDocument | null, focus: 'context' | 'selection'): PalaceView {
  if (focus === 'context' || !selected) return 'context'
  return palaceMemoryPlacement(selected.path).placement === 'baseline' ? 'core' : 'external'
}

function snapshotMain(
  snapshot: PalaceSnapshot,
  reloadPath: string,
  document: PalaceDocument | null,
  focus: 'context' | 'selection',
  provenance: PalacePreviewProvenance,
  context: PalaceContextSnapshot | null,
): string {
  const selected = document && document.commit === snapshot.head ? document : null
  const current = openedView(selected, focus)
  const filesTitle = current === 'external' ? 'On-demand library' : 'Baseline memory'
  const empty =
    snapshot.corpus.total === 0 && snapshot.jobs.total === 0
      ? '<p>No committed memory files and no maintenance jobs are in this snapshot.</p>'
      : ''
  return `${empty}${contextHtml(context, recoveryNote(snapshot))}<div class="files-layout" id="memory" data-palace-commit="${escapePalaceText(snapshot.head)}" data-preview-provenance="${provenance}" data-palace-page="${escapePalaceText(reloadPath)}" data-palace-document="${escapePalaceText(reloadPath)}/document/${escapePalaceText(snapshot.head)}/" data-palace-read="${escapePalaceText(reloadPath)}/read/${escapePalaceText(snapshot.head)}/" data-palace-corpus="${escapePalaceText(reloadPath)}/corpus/${escapePalaceText(snapshot.head)}" data-palace-selected="${escapePalaceText(selected?.path ?? '')}" data-palace-open="${current}" data-corpus-total="${snapshot.corpus.total}" data-corpus-returned="${snapshot.corpus.returned}" data-corpus-truncated="${snapshot.corpus.truncated ? 'true' : 'false'}">${browserHtml(snapshot, reloadPath, selected?.path ?? null, filesTitle)}${readerHtml(selected, snapshot.head, provenance)}</div><noscript><p>Path filtering, tab focus, and later corpus pages need JavaScript. This page shows context, the loaded corpus page, and history together. File links still open each listed memory file, and both Rendered and Raw remain visible.</p></noscript>${historyHtml(snapshot)}`
}

function previewProvenance(value: PalacePreviewProvenance | undefined): PalacePreviewProvenance {
  return value === 'private-shadow' ? 'private-shadow' : 'synthetic'
}

function previewFooter(provenance: PalacePreviewProvenance): string {
  return provenance === 'private-shadow'
    ? 'Read-only private-shadow workspace · ABI2 remains live authority · This page does not mutate live memory.'
    : 'Read-only synthetic workspace · ABI2 remains live authority · No mutation controls; reads may reconcile or recover under the service owner.'
}

function shell(input: {
  title: string
  state: string
  reloadPath: string
  links: string | null
  subtitle: string
  main: string
  script: boolean
  provenance: PalacePreviewProvenance
  fonts?: PalaceFontFaces
}): string {
  const reload = escapePalaceText(input.reloadPath)
  const links = input.links ?? `<li><a href="${reload}">Reload</a></li>`
  const fonts = palaceFontFaces(input.fonts ?? palaceFontHrefs(input.reloadPath, input.reloadPath))
  const manrope = escapePalaceText(fonts.manrope)
  const fira = escapePalaceText(fonts.fira)
  const script = input.script ? `<script>${palacePreviewScript()}</script>` : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapePalaceText(input.title)} | not live authority</title>
<link rel="preload" href="${manrope}" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${fira}" as="font" type="font/woff2" crossorigin>
<style>${palacePreviewStyle(fonts)}</style>
</head>
<body data-preview-state="${escapePalaceText(input.state)}" data-preview-provenance="${input.provenance}">
<a class="skip-link" href="#content">Skip to content</a>
<div class="app-shell">
<header class="header">
<div class="header-brand"><span class="product-mark" aria-hidden="true">${mahiroMarkSvg}</span><span class="product-name">Mahiro Pi</span></div>
<div class="agent-meta"><h1 class="agent-name">Palace</h1><p class="agent-id">${escapePalaceText(input.subtitle)}</p></div>
<a href="${reload}">Reload</a>
</header>
<nav class="tabs" aria-label="Palace"><ul>${links}</ul></nav>
<main id="content" class="main" tabindex="-1">
${input.main}
</main>
<footer><p>${previewFooter(input.provenance)}</p></footer>
</div>
${script}
</body>
</html>`
}

export function renderPalacePage(page: PalaceRenderPage): string {
  const provenance = previewProvenance(page.provenance)
  const statusSubtitle =
    provenance === 'private-shadow'
      ? 'Private-shadow preview · Not live authority'
      : 'Synthetic preview · Not live authority'
  if (page.state === 'loading') {
    return shell({
      title:
        provenance === 'private-shadow'
          ? 'Loading private-shadow Palace preview'
          : 'Loading synthetic Palace preview',
      state: 'loading',
      reloadPath: page.reloadPath,
      links: null,
      subtitle: statusSubtitle,
      script: false,
      provenance,
      fonts: page.fonts,
      main:
        provenance === 'private-shadow'
          ? '<p>Loading the private-shadow preview. Reload to read it. This page does not refresh automatically.</p>'
          : '<p>Loading the memory snapshot. Reload to read it. This page does not refresh automatically.</p>',
    })
  }
  if (page.state === 'error') {
    return shell({
      title: 'Palace preview unavailable',
      state: 'error',
      reloadPath: page.reloadPath,
      links: null,
      subtitle: statusSubtitle,
      script: false,
      provenance,
      fonts: page.fonts,
      main:
        provenance === 'private-shadow'
          ? '<p>Private-shadow preview is unavailable. Reload to try again. Live memory is unchanged.</p>'
          : '<p>Palace preview is unavailable. Reload to try again. Live memory is unchanged.</p>',
    })
  }
  if (page.state === 'stale') {
    return shell({
      title: 'Palace snapshot is stale',
      state: 'stale',
      reloadPath: page.reloadPath,
      links: null,
      subtitle: statusSubtitle,
      script: false,
      provenance,
      fonts: page.fonts,
      main:
        provenance === 'private-shadow'
          ? '<p>This private-shadow preview snapshot is stale. Reload to read the coordinator again. This page did not publish.</p>'
          : '<p>This snapshot is stale. Reload to read the coordinator again. This page did not publish.</p>',
    })
  }
  const selected = page.document && page.document.commit === page.snapshot.head ? page.document : null
  const state = page.snapshot.corpus.total === 0 && page.snapshot.jobs.total === 0 ? 'empty' : 'snapshot'
  const focus = page.focus ?? 'selection'
  const current = openedView(selected, focus)
  const subtitle =
    provenance === 'private-shadow'
      ? `${page.snapshot.head.slice(0, 7)} · Migrated real memory · Private shadow · Not live authority`
      : `${page.snapshot.head.slice(0, 7)} · Synthetic preview · Not live authority`
  return shell({
    title: 'Palace',
    state,
    reloadPath: page.reloadPath,
    links: viewLinks(
      current,
      tabCountLabel(loadedFiles(page.snapshot, true), page.snapshot.corpus.truncated),
      tabCountLabel(loadedFiles(page.snapshot, false), page.snapshot.corpus.truncated),
    ),
    subtitle,
    script: true,
    provenance,
    fonts: page.fonts,
    main: snapshotMain(page.snapshot, page.reloadPath, selected, focus, provenance, page.context ?? null),
  })
}
