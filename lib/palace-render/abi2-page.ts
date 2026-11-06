import { bytes } from '../continuity/records.ts'
import type { PalaceHandoff } from '../agent-memory/palace-handoff.ts'
import { utf8Preview } from '../agent-memory/palace-structure.ts'

const mahiroMarkSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1254" aria-hidden="true" focusable="false"><path fill="#0a0606" fill-rule="evenodd" d="M 1100.5 857.0 C 1100.8 862.0 1100.0 879.4 1099.5 884.0 C 1099.0 888.6 1096.2 902.0 1094.5 907.0 C 1092.8 912.0 1083.1 934.2 1080.5 939.0 C 1077.9 943.8 1069.8 955.0 1066.5 959.0 C 1063.2 963.0 1048.3 978.6 1044.0 982.5 C 1039.7 986.4 1025.0 998.0 1020.0 1001.5 C 1015.0 1005.0 995.3 1017.1 989.0 1020.5 C 982.7 1023.9 958.6 1035.4 951.0 1038.5 C 943.4 1041.6 914.6 1051.8 906.0 1054.5 C 897.4 1057.2 869.9 1064.8 857.0 1067.5 C 844.1 1070.2 783.2 1081.3 765.0 1083.5 C 746.8 1085.7 678.5 1091.0 658.0 1091.5 C 637.5 1092.0 560.2 1090.1 541.0 1088.5 C 521.8 1086.9 463.2 1077.6 448.0 1074.5 C 432.8 1071.4 388.4 1059.3 375.0 1054.5 C 361.6 1049.7 313.1 1028.3 302.0 1022.5 C 290.9 1016.7 263.0 998.8 254.0 991.5 C 245.0 984.2 211.2 951.9 203.5 943.0 C 195.8 934.1 174.8 903.4 169.5 894.0 C 164.2 884.6 148.6 848.5 145.5 840.0 C 142.4 831.5 136.8 807.5 135.5 801.0 C 134.2 794.5 131.9 775.1 131.5 769.0 C 131.1 762.9 130.9 741.1 131.5 734.0 C 132.1 726.9 135.8 699.2 137.5 691.0 C 139.2 682.8 147.8 651.9 150.5 644.0 C 153.2 636.1 166.7 614.0 167.5 605.0 C 168.3 596.0 160.3 558.2 159.5 546.0 C 158.7 533.8 157.6 487.3 158.5 472.0 C 159.4 456.7 166.8 394.5 169.5 379.0 C 172.2 363.5 183.0 317.4 187.5 303.0 C 192.0 288.6 213.0 233.6 218.5 222.0 C 224.0 210.4 243.6 182.3 247.5 177.0 C 251.4 171.7 258.2 166.5 261.0 164.5 C 263.8 162.5 273.2 156.6 278.0 155.5 C 282.8 154.4 307.5 152.2 313.0 152.5 C 318.5 152.8 333.2 156.8 338.0 158.5 C 342.8 160.2 356.9 165.6 365.0 170.5 C 373.1 175.4 414.4 202.7 426.0 212.5 C 437.6 222.3 479.8 263.6 491.5 277.0 C 503.2 290.4 539.0 351.0 554.0 358.5 C 569.0 366.0 640.2 357.7 655.0 358.5 C 669.8 359.3 707.0 366.0 715.0 367.5 C 723.0 369.0 736.0 377.4 742.0 374.5 C 748.0 371.6 773.6 341.6 780.0 335.5 C 786.4 329.4 802.0 315.6 812.0 308.5 C 822.0 301.4 878.9 263.6 889.0 257.5 C 899.1 251.4 916.4 244.6 922.0 242.5 C 927.6 240.4 945.2 235.2 950.0 234.5 C 954.8 233.8 970.2 233.8 974.0 234.5 C 977.8 235.2 988.3 240.3 991.0 242.5 C 993.7 244.7 1001.2 254.4 1003.5 259.0 C 1005.8 263.6 1014.0 282.8 1016.5 293.0 C 1019.0 303.2 1029.1 354.3 1030.5 370.0 C 1031.9 385.7 1032.6 448.0 1031.5 464.0 C 1030.4 480.0 1017.5 533.5 1018.5 545.0 C 1019.5 556.5 1038.4 579.6 1042.5 589.0 C 1046.6 598.4 1060.6 637.5 1063.5 648.0 C 1066.4 658.5 1072.8 692.0 1074.5 704.0 C 1076.2 716.0 1079.5 767.5 1081.5 779.0 C 1083.5 790.5 1094.8 821.9 1096.5 829.0 C 1098.2 836.1 1100.2 852.0 1100.5 857.0 Z"/><path fill="#a552fc" fill-rule="evenodd" d="M 441.5 408.0 C 442.4 411.3 442.3 415.2 441.5 417.0 C 440.7 418.8 437.7 424.2 433.0 427.5 C 428.3 430.8 398.2 447.2 390.0 452.5 C 381.8 457.8 354.6 475.4 343.0 485.5 C 331.4 495.6 271.9 555.4 264.0 562.5 C 256.1 569.6 258.1 562.9 257.0 562.5 C 255.9 562.1 252.9 560.3 251.5 558.0 C 250.1 555.7 243.2 542.7 241.5 537.0 C 239.8 531.3 234.5 503.9 233.5 496.0 C 232.5 488.1 230.5 461.0 230.5 451.0 C 230.5 441.0 231.8 400.3 233.5 387.0 C 235.2 373.7 245.1 318.7 248.5 306.0 C 251.9 293.3 267.4 254.6 270.5 248.0 C 273.6 241.4 280.3 236.0 282.0 234.5 C 283.7 233.0 287.0 231.5 289.0 231.5 C 291.0 231.5 300.8 233.1 304.0 234.5 C 307.2 235.9 317.8 241.2 324.0 246.5 C 330.2 251.8 363.2 282.5 371.5 292.0 C 379.8 301.5 409.0 341.8 414.5 350.0 C 420.0 358.2 429.0 375.7 431.5 381.0 C 434.0 386.3 440.6 404.7 441.5 408.0 Z"/><path fill="#fdf5d9" fill-rule="evenodd" d="M 767.5 708.0 C 768.3 715.8 766.9 744.2 765.5 751.0 C 764.1 757.8 754.9 777.7 752.5 782.0 C 750.1 786.3 741.5 795.2 739.0 797.5 C 736.5 799.8 729.6 805.5 725.0 807.5 C 720.4 809.5 694.1 818.3 689.0 819.5 C 683.9 820.7 673.1 820.8 669.0 820.5 C 664.9 820.2 649.4 818.4 644.0 816.5 C 638.6 814.6 615.4 803.7 610.0 799.5 C 604.6 795.3 588.4 774.9 585.5 771.0 C 582.6 767.1 579.8 760.8 578.5 757.0 C 577.2 753.2 572.1 734.9 571.5 730.0 C 570.9 725.1 571.1 708.1 571.5 704.0 C 571.9 699.9 573.5 689.9 575.5 685.0 C 577.5 680.1 590.2 655.7 593.5 651.0 C 596.8 646.3 607.5 636.3 611.0 633.5 C 614.5 630.7 626.8 622.6 632.0 620.5 C 637.2 618.4 662.0 611.2 668.0 610.5 C 674.0 609.8 693.2 611.5 698.0 612.5 C 702.8 613.5 716.9 619.9 720.0 621.5 C 723.1 623.1 729.7 628.3 732.0 630.5 C 734.3 632.7 743.3 642.7 745.5 646.0 C 747.7 649.3 754.5 660.3 756.5 666.0 C 758.5 671.7 766.7 700.2 767.5 708.0 Z M 758.5 702.0 C 759.0 706.0 759.2 718.6 758.5 723.0 C 757.8 727.4 752.4 746.1 750.5 750.0 C 748.6 753.9 740.5 763.4 738.0 765.5 C 735.5 767.6 725.9 772.0 723.0 772.5 C 720.1 773.0 709.1 771.8 706.0 770.5 C 702.9 769.2 692.0 760.8 689.5 758.0 C 687.0 755.2 680.1 744.1 678.5 740.0 C 676.9 735.9 672.9 717.8 672.5 713.0 C 672.1 708.2 673.7 691.9 674.5 688.0 C 675.3 684.1 679.5 673.2 681.5 670.0 C 683.5 666.8 693.6 655.5 696.0 653.5 C 698.4 651.5 705.2 648.8 708.0 648.5 C 710.8 648.2 723.6 648.9 727.0 650.5 C 730.4 652.1 743.2 663.4 745.5 666.0 C 747.8 668.6 751.3 675.7 752.5 679.0 C 753.7 682.3 758.0 698.0 758.5 702.0 Z M 1053.5 764.0 C 1053.7 770.5 1051.0 789.8 1049.5 795.0 C 1048.0 800.2 1040.2 817.3 1037.5 821.0 C 1034.8 824.7 1023.6 834.0 1020.0 835.5 C 1016.4 837.0 1001.5 838.0 998.0 837.5 C 994.5 837.0 985.1 832.0 982.0 829.5 C 978.9 827.0 967.1 814.0 964.5 810.0 C 961.9 806.0 955.1 791.4 953.5 786.0 C 951.9 780.6 947.7 757.3 947.5 751.0 C 947.3 744.7 950.0 722.6 951.5 717.0 C 953.0 711.4 961.1 693.8 963.5 690.0 C 965.9 686.2 974.5 677.4 978.0 675.5 C 981.5 673.6 998.3 669.5 1002.0 669.5 C 1005.7 669.5 1015.0 673.3 1018.0 675.5 C 1021.0 677.7 1031.8 688.6 1034.5 693.0 C 1037.2 697.4 1045.8 717.5 1047.5 724.0 C 1049.2 730.5 1053.3 757.5 1053.5 764.0 Z M 1048.5 743.0 C 1049.3 749.0 1047.2 770.9 1046.5 775.0 C 1045.8 779.1 1041.8 786.1 1040.5 788.0 C 1039.2 789.9 1033.8 794.9 1032.0 795.5 C 1030.2 796.1 1023.2 795.8 1021.0 794.5 C 1018.8 793.2 1010.2 783.5 1008.5 781.0 C 1006.8 778.5 1003.4 770.4 1002.5 767.0 C 1001.6 763.6 998.5 749.0 998.5 744.0 C 998.5 739.0 1001.8 715.7 1002.5 712.0 C 1003.2 708.3 1005.1 705.5 1006.5 704.0 C 1007.9 702.5 1016.0 696.0 1018.0 695.5 C 1020.0 695.0 1026.2 697.3 1028.0 698.5 C 1029.8 699.7 1035.6 704.9 1037.5 709.0 C 1039.4 713.1 1047.7 737.0 1048.5 743.0 Z M 915.5 860.0 C 915.9 861.1 916.1 865.6 915.5 867.0 C 914.9 868.4 911.2 874.4 909.0 875.5 C 906.8 876.6 893.7 878.7 891.0 878.5 C 888.3 878.3 882.0 875.1 880.0 873.5 C 878.0 871.9 871.7 860.8 869.0 860.5 C 866.3 860.2 854.9 869.6 851.0 870.5 C 847.1 871.4 830.1 871.0 827.0 870.5 C 823.9 870.0 819.0 867.3 817.0 865.5 C 815.0 863.7 806.6 852.9 805.5 851.0 C 804.4 849.1 805.0 846.1 805.5 845.0 C 806.0 843.9 808.3 839.2 811.0 839.5 C 813.7 839.8 831.7 847.8 835.0 848.5 C 838.3 849.2 844.8 848.4 847.0 847.5 C 849.2 846.6 856.9 840.7 858.5 839.0 C 860.1 837.3 863.8 829.6 865.0 828.5 C 866.2 827.4 870.8 827.2 872.0 827.5 C 873.2 827.8 877.4 830.2 878.5 832.0 C 879.6 833.8 882.4 844.9 883.5 847.0 C 884.6 849.1 888.5 853.7 891.0 854.5 C 893.5 855.3 908.8 855.0 911.0 855.5 C 913.2 856.0 915.1 858.9 915.5 860.0 Z"/></svg>'

const contextBlockCount = 480
const contextKeys = ['system', 'core', 'external', 'messages', 'free'] as const
type ContextKey = (typeof contextKeys)[number]

const contextLabel: Record<ContextKey, string> = {
  system: 'System',
  core: 'Core Memory',
  external: 'External Memory',
  messages: 'Messages',
  free: 'Free',
}

const contextSymbol: Record<ContextKey, string> = {
  system: '\u25C9',
  core: '\u25C9',
  external: '\u25CF',
  messages: '\u25CF',
  free: '\u25A1',
}

function contextCoverageCss(): string {
  const fills = Array.from({ length: 101 }, (_, step) => `.ctx-fill-${step} { inline-size: ${step}%; }`).join(
    '\n',
  )
  const hover = contextKeys
    .map(
      (key) => `
.context-grid:has([data-cat="${key}"]:hover) [data-cat="${key}"] { opacity: 1; filter: brightness(1.5); transform: scale(1.25); }
.context-grid:has([data-cat="${key}"]:hover) .block:not([data-cat="${key}"]) { opacity: 0.15; }
.context-layout:has(.context-grid [data-cat="${key}"]:hover) .ctx-legend-item:not([data-legend="${key}"]) { opacity: 0.25; }
.context-layout:has(.ctx-legend-item[data-legend="${key}"]:hover) .context-grid [data-cat="${key}"] { opacity: 1; filter: brightness(1.5); transform: scale(1.25); }
.context-layout:has(.ctx-legend-item[data-legend="${key}"]:hover) .context-grid .block:not([data-cat="${key}"]) { opacity: 0.15; }`,
    )
    .join('\n')
  return `${fills}\n${hover}`
}

export const abi2PalaceStyle = `
/* Letta Code src/web/memory-viewer-template.txt, Apache-2.0.
 * v0.34.36 / 8f72222dec142dfc2316692d68ada3ab2e439d46.
 * Unchanged from audited v0.34.31 / a8900b882446d7aa99fedf2845d400743affd1b6.
 * See THIRD_PARTY_NOTICES.md. No remote fonts, scripts or asset routes.
 */
:root {
  color-scheme: light dark;
  --accent: hsl(240, 93%, 35%);
  --accent-light: hsl(240, 67%, 98%);
  --accent-light-border: hsl(240, 62%, 94%);
  --bg: #ffffff;
  --panel: #ffffff;
  --border: hsl(210, 10%, 92.2%);
  --text: hsl(0, 0%, 8%);
  --text-muted: hsl(210, 3%, 28%);
  --text-dim: hsl(210, 3%, 66%);
  --mono: 'Fira Code', Menlo, Courier, monospace;
  --sans: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', sans-serif;
  --serif: 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, serif;
  --radius: 6px;
  --max-w: 1180px;
  --surface: hsl(0, 0%, 98%);
  --surface-2: hsl(0, 0%, 96%);
  --hover: hsl(0, 0%, 96%);
  --hover-accent: hsl(240, 67%, 98%);
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
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.app-shell {
  max-width: var(--max-w);
  margin: 22px auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--panel);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 6px 16px rgba(0, 0, 0, 0.04);
}
.header {
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  display: flex;
  gap: 12px;
  align-items: center;
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
.header h1, .header .agent-name {
  font-family: var(--sans);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
  margin: 0;
}
.tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
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
}
.tab:hover { color: var(--text); }
.main { padding: 16px; }
.panel {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--panel);
}
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #ddd; padding: 6px 10px; }
th { background: var(--surface); text-align: left; }
.status {
  margin-left: 6px;
  font-size: 10px;
  color: var(--accent);
  background: var(--accent-light);
  border: 1px solid var(--accent-light-border);
  border-radius: 999px;
  padding: 0 6px;
}
footer {
  margin-top: 14px;
  border-top: 1px solid var(--border);
  padding: 10px 16px 14px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}
nav ul { flex-wrap: wrap; list-style: none; }
.tab { display: block; }
section { margin-bottom: 16px; }
h2, caption {
  padding: 8px 12px;
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
  text-align: left;
}
.lede, .notice, .meta, .note { padding: 10px 14px; color: var(--text-muted); font-size: 12px; }
.notice { border-bottom: 1px solid var(--border); background: var(--surface); }
code, time { font-family: var(--mono); }
code { overflow-wrap: anywhere; }
@media (prefers-color-scheme: dark) {
  :root {
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
  }
  .app-shell { box-shadow: 0 1px 3px rgba(0,0,0,0.2), 0 6px 16px rgba(0,0,0,0.3); }
  .tabs { background: var(--surface-2); }
  .status { background: var(--surface); border-color: var(--border); }
  th { background: var(--surface); color: var(--text); }
  th, td { border-color: var(--border); }
}
@media (forced-colors: active) { .panel, .app-shell { border: 1px solid CanvasText; } }
.agent-meta { margin-left: auto; text-align: right; min-width: 0; overflow-wrap: anywhere; }
.agent-id, .lc-meta, .file-chars, .dir-count { color: var(--text-dim); font-size: 11px; }
.view-radio, .file-radio, .raw-toggle-input { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.view { display: none; }
.app-shell:has(#view-context:checked) .view-context,
.app-shell:has(#view-core:checked) .view-core,
.app-shell:has(#view-external:checked) .view-external,
.app-shell:has(#view-history:checked) .view-history { display: block; }
.app-shell:has(#view-context:checked) label.tab[for="view-context"],
.app-shell:has(#view-core:checked) label.tab[for="view-core"],
.app-shell:has(#view-external:checked) label.tab[for="view-external"],
.app-shell:has(#view-history:checked) label.tab[for="view-history"] { color: var(--accent); background: var(--panel); box-shadow: inset 0 -2px 0 var(--accent); }
.view-radio:focus-visible ~ nav, .files-layout:has(.file-radio:focus-visible) .tree-panel,
.raw-toggle-input:focus-visible + .raw-toggle { outline: 2px solid var(--accent); outline-offset: -2px; }
.files-layout { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 16px; height: 74vh; }
.tree-panel { overflow: auto; min-width: 0; background: var(--surface-2); }
.file-panel { overflow: auto; min-width: 0; display: flex; flex-direction: column; }
.tree-desc { position: sticky; top: 0; padding: 8px 12px; background: var(--surface-2); border-bottom: 1px solid var(--border); font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--text-dim); z-index: 1; }
.tree-children { margin-left: 12px; padding-left: 8px; border-left: 1px solid var(--border); }
.tree-dir > summary { list-style: none; }
.tree-dir > summary::-webkit-details-marker { display: none; }
.tree-dir > summary::before { content: "▸"; inline-size: 0.8rem; flex: 0 0 auto; color: var(--text-dim); }
.tree-dir[open] > summary::before { content: "▾"; }
.tree-item { display: flex; align-items: center; gap: 6px; padding: 5px 10px; cursor: pointer; overflow-wrap: anywhere; font-size: 13px; color: var(--text); user-select: none; }
.tree-item:hover { background: var(--hover-accent); }
.tree-item.file-list-entry { cursor: default; }
.tree-item.file-list-entry:hover { background: none; }
.tree-item.dir { color: var(--text-muted); border-left: 2px solid var(--accent); }
.tree-file-name { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.dir-count, .file-chars { margin-left: auto; flex: 0 0 auto; white-space: nowrap; }
.file-document { display: contents; }
.file-content { display: none; }
.file-radio:checked + .file-content { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.file-last-commit { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 8px 14px; background: var(--surface); border-bottom: 1px solid var(--border); font-size: 12px; cursor: pointer; }
.file-last-commit:hover { background: var(--hover); }
.lc-hash, .commit-hash { font-family: var(--mono); font-size: 11px; color: var(--accent); background: var(--accent-light); border-radius: 4px; padding: 1px 6px; flex-shrink: 0; }
.lc-msg { flex: 1; overflow-wrap: anywhere; color: var(--text); }
.file-meta { position: relative; padding: 10px 14px; background: var(--surface); border-bottom: 1px solid var(--border); }
.file-path { font-family: var(--mono); font-size: 12px; color: var(--text); margin-bottom: 6px; padding-right: 54px; }
.meta-row { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 0; }
.meta-pill { font-size: 12px; color: var(--text-muted); padding: 2px 8px; background: var(--panel); border: 1px solid var(--border); border-radius: 999px; overflow-wrap: anywhere; }
.meta-pill strong { color: var(--text); font-weight: 500; }
.raw-toggle { position: absolute; top: 8px; right: 10px; font-size: 11px; padding: 3px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--panel); color: var(--text-muted); cursor: pointer; user-select: none; }
.raw-toggle:hover { background: var(--accent-light); color: var(--accent); }
.raw-toggle-input:checked + .raw-toggle { background: var(--accent); color: #fff; }
.file-body, .file-body-raw { padding: 20px 28px; overflow-wrap: anywhere; flex: 1; overflow: auto; }
.file-body { font-family: var(--serif); font-size: 16px; line-height: 1.65; }
.file-body h1, .file-body h2, .file-body h3 { margin: 18px 0 8px; font-family: var(--serif); font-weight: 600; line-height: 1.3; color: var(--text); background: none; text-transform: none; letter-spacing: normal; padding: 0; border: 0; }
.file-body h1 { font-size: 28px; }
.file-body h2 { font-size: 22px; border-bottom: 1px solid var(--border); }
.file-body h3 { font-size: 18px; }
.file-body code { font-family: var(--mono); font-size: 13px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }
.file-body p, .file-body ul, .file-body ol, .file-body blockquote { margin: 10px 0; }
.file-body ul, .file-body ol { padding-left: 24px; }
.file-body blockquote { border-left: 3px solid var(--accent); padding-left: 12px; color: var(--text-muted); }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--mono); }
.file-body pre { background: var(--surface-2); border-radius: 8px; padding: 12px; overflow: auto; }
.file-body pre code { background: transparent; border: 0; padding: 0; }
.file-body-raw { display: none; background: var(--surface-2); font-size: 13px; line-height: 1.6; }
.file-content:has(.raw-toggle-input:checked) .file-body { display: none; }
.file-content:has(.raw-toggle-input:checked) .file-body-raw { display: block; }
.context-panel { margin-bottom: 0; }
.context-layout { display: flex; min-height: 400px; min-width: 0; }
.context-grid-area { flex: 1; padding: 20px; display: flex; align-items: flex-start; justify-content: center; min-width: 0; }
.context-sidebar { width: 280px; min-width: 280px; padding: 20px; border-left: 1px solid var(--border); background: var(--surface); }
.context-grid { display: flex; flex-wrap: wrap; gap: 4px; max-width: min(700px, 100%); padding: 8px; }
.context-grid .block { width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; font-size: 14px; line-height: 1; user-select: none; transition: transform 0.1s ease, opacity 0.1s ease; }
.ctx-system { color: rgb(224, 112, 80); }
.ctx-core { color: rgb(224, 160, 64); }
.ctx-external { color: rgb(32, 178, 170); }
.ctx-messages, .ctx-unattributed { color: rgb(140, 140, 249); }
.ctx-free { color: var(--text-dim); opacity: .35; }
.ctx-model { font-size: 14px; font-weight: 500; color: var(--text); margin-bottom: 2px; overflow-wrap: anywhere; }
.ctx-model-sub { font-size: 11px; color: var(--text-dim); margin-bottom: 12px; }
.ctx-usage-label { font-size: 13px; color: var(--text-muted); margin-bottom: 6px; }
.ctx-bar-track { height: 6px; background: var(--surface-2); border-radius: 3px; overflow: hidden; margin-bottom: 4px; }
.ctx-bar-fill { height: 100%; border-radius: 3px; background: var(--accent); }
.ctx-bar-text { font-size: 11px; color: var(--text-dim); margin-bottom: 20px; }
.ctx-legend-title { font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: var(--text-dim); margin-bottom: 10px; }
.ctx-legend-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; color: var(--text-muted); }
label.ctx-legend-item { cursor: pointer; }
label.ctx-legend-item:hover { color: var(--text); }
.ctx-legend-sym { font-size: 14px; width: 18px; text-align: center; flex: 0 0 auto; }
.ctx-legend-name { flex: 1; min-width: 0; }
.ctx-legend-arrow { font-size: 11px; color: var(--text-dim); margin-left: 4px; }
.ctx-legend-value { text-align: right; color: var(--text-dim); font-size: 11px; white-space: nowrap; }
${contextCoverageCss()}
${Array.from({ length: 128 }, (_, index) => `.files-layout:has([id$="-file-${index}"]:checked) [for$="-file-${index}"] { background: var(--accent-light); color: var(--accent); font-weight: 600; box-shadow: inset 2px 0 0 var(--accent); }\n.files-layout:has([id$="-file-${index}"]:focus-visible) [for$="-file-${index}"] { outline: 2px solid var(--accent); outline-offset: -2px; }`).join('\n')}
.history-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.history-search-status { font-size: 12px; color: var(--text-dim); }
.commit-list { display: grid; gap: 10px; }
.commit-item { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--panel); }
.commit-head { display: grid; grid-template-columns: 120px minmax(0, 1fr) auto; align-items: start; gap: 12px; padding: 12px 14px; cursor: pointer; background: var(--surface); list-style: none; }
.commit-head::-webkit-details-marker { display: none; }
.commit-head:hover { background: var(--hover); }
.commit-left { display: flex; flex-direction: column; gap: 5px; align-items: flex-start; }
.commit-center { display: flex; flex-direction: column; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
.commit-title { font-family: var(--sans); font-size: 13px; color: var(--text); }
.commit-preview, .commit-meta { color: var(--text-dim); font-size: 11px; }
.commit-body { border-top: 1px solid var(--border); padding: 8px 0; background: var(--panel); overflow: auto; }
.diff-bar { display: inline-flex; gap: 4px; align-items: center; font-size: 10px; }
.db-blocks { display: inline-flex; gap: 1px; margin-left: 2px; }
.db-block { display: inline-block; width: 6px; height: 6px; border-radius: 1px; background: var(--border); }
.db-block.add { background: #2da44e; }
.db-block.del { background: #cf222e; }
.db-plus { color: #1a7f37; }
.db-minus { color: #cf222e; }
.diff-line { display: block; padding: 0 12px; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.diff-line.add { background: #dafbe1; color: #1a7f37; }
.diff-line.del { background: #ffebe9; color: #cf222e; }
.diff-line.hunk { background: #ddf4ff; color: var(--accent); }
.diff-line.hunk, .diff-file-header { padding: 2px 12px; }
.diff-file-header { color: var(--accent); font-weight: 500; background: var(--surface); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); margin-top: 4px; }
@media (prefers-color-scheme: dark) {
  .db-plus { color: #7ee787; }
  .db-minus { color: #ffa198; }
  .diff-line.add { background: hsl(140, 30%, 14%); color: #7ee787; }
  .diff-line.del { background: hsl(0, 40%, 16%); color: #ffa198; }
  .diff-line.hunk { background: hsl(210, 30%, 16%); color: hsl(210, 40%, 70%); }
}
@media (max-width: 900px) { .files-layout { grid-template-columns: minmax(0, 1fr); height: auto; } .tree-panel { max-height: 32vh; } .file-panel { min-height: 42vh; } .context-layout { flex-direction: column; } .context-sidebar { width: auto; min-width: 0; border-left: 0; border-top: 1px solid var(--border); } }
@media (max-width: 600px) { .header { flex-wrap: wrap; } .agent-meta { text-align: left; margin-left: 0; } .main { padding: 8px; } .tab { padding: 10px; letter-spacing: 1px; } .commit-head { grid-template-columns: minmax(0, 1fr); } }
`

export function renderAbi2PalacePage(handoff: PalaceHandoff): string {
  const context = handoff.diagnostic.context
  const structure = handoff.diagnostic.structure
  const history = handoff.history
  const core = structure.files.filter(isCore)
  const external = structure.files.filter((file) => !isCore(file))
  const views = [
    ['context', 'Context'],
    ['core', `Core Memory (${core.length})`],
    ['external', `External Memory (${external.length})`],
    ['history', 'History'],
  ] as const
  const viewInputs = views
    .map(
      ([id], index) =>
        `<input class="view-radio" type="radio" name="palace-view" id="view-${id}"${index === 0 ? ' checked' : ''} aria-label="${id} view">`,
    )
    .join('')
  const viewTabs = views
    .map(([id, title]) => `<li><label class="tab" for="view-${id}">${title}</label></li>`)
    .join('')
  const buildHtml = (previewBytes: number, previewLines: number, compact = false) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escape(structure.project)}'s Memory Palace | Mahiro Pi</title>
<style>${abi2PalaceStyle}</style>
</head>
<body>
<div class="app-shell">
<header class="header">
<div class="header-brand">
<span class="product-mark" aria-hidden="true">${mahiroMarkSvg}</span>
<span class="product-name">Mahiro Pi</span>
</div>
<div class="agent-meta"><h1 class="agent-name">${escape(structure.project)}'s Memory Palace</h1><div class="agent-id">${escape(structure.revision.slice(0, 7))}</div></div>
</header>
${viewInputs}
<nav aria-label="Page sections"><ul class="tabs">${viewTabs}</ul></nav>
<main id="content" class="main">
<div class="view view-context" aria-label="Context">${contextView(handoff, core, external)}</div>
<div class="view view-core" aria-label="Core Memory">${fileWorkspace(core, 'core', handoff, previewBytes, compact)}</div>
<div class="view view-external" aria-label="External Memory">${fileWorkspace(external, 'external', handoff, previewBytes, compact)}</div>
<div class="view view-history" aria-label="History">${commitCards(handoff, previewBytes, previewLines, compact)}</div>
</main>
<footer>Captured <time datetime="${escape(context.capturedAt)}">${escape(formatShortDate(context.capturedAt))}</time> · Close with <code>/mh-memory palace close</code></footer>
</div>
</body>
</html>`
  for (const [previewBytes, previewLines, compact] of [
    [8192, 256, false],
    [4096, 128, false],
    [2048, 64, false],
    [1024, 32, false],
    [256, 12, false],
    [128, 4, true],
  ] as const) {
    const html = buildHtml(previewBytes, previewLines, compact)
    if (bytes(html) <= 256 * 1024) return html
  }
  throw Error('Palace HTML exceeds bound')
}

type PalaceFile = PalaceHandoff['diagnostic']['structure']['files'][number]

function isCore(file: PalaceFile): boolean {
  return file.layer === 'core' || file.layer === 'index' || file.path.startsWith('system/')
}

function frontmatter(body: string): { text: string; badges: [string, string][] } {
  const lines = body.split('\n')
  if (lines[0]?.trim() !== '---') return { text: body, badges: [] }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end < 0) return { text: body, badges: [] }
  const badges: [string, string][] = []
  for (const line of lines.slice(1, end)) {
    const match = /^(description|limit|read_only):\s*(.*)$/.exec(line)
    if (match) badges.push([match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')])
  }
  return { text: lines.slice(end + 1).join('\n'), badges }
}

function inlineMarkdown(text: string): string {
  return escape(text).replace(/`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g, (_, code, strong, em) => {
    if (code !== undefined) return `<code>${code}</code>`
    if (strong !== undefined) return `<strong>${strong}</strong>`
    return `<em>${em}</em>`
  })
}

function markdown(body: string): string {
  const lines = body.split('\n')
  const output: string[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index++]
    if (!line.trim()) continue
    if (/^\s*```/.test(line)) {
      const code: string[] = []
      while (index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index++])
      if (index < lines.length) index++
      output.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`)
      continue
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1].length
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`)
      continue
    }
    const list = /^\s*(?:([-*])|\d+\.)\s+(.*)$/.exec(line)
    if (list) {
      const ordered = !list[1]
      const pattern = ordered ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-*]\s+(.*)$/
      const items = [list[2]]
      while (index < lines.length) {
        const next = pattern.exec(lines[index])
        if (!next) break
        items.push(next[1])
        index++
      }
      const tag = ordered ? 'ol' : 'ul'
      output.push(`<${tag}>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('')}</${tag}>`)
      continue
    }
    if (/^>\s?/.test(line)) {
      const quote = [line.replace(/^>\s?/, '')]
      while (index < lines.length && /^>\s?/.test(lines[index]))
        quote.push(lines[index++].replace(/^>\s?/, ''))
      output.push(`<blockquote>${inlineMarkdown(quote.join('\n'))}</blockquote>`)
      continue
    }
    const paragraph = [line]
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(?:#{1,3}\s|\s*```|\s*[-*]\s|\s*\d+\.\s|>)/.test(lines[index])
    )
      paragraph.push(lines[index++])
    output.push(`<p>${inlineMarkdown(paragraph.join('\n'))}</p>`)
  }
  return output.join('\n')
}

function fileWorkspace(
  files: readonly PalaceFile[],
  group: string,
  handoff: PalaceHandoff,
  previewBytes: number,
  compact: boolean,
): string {
  type Tree = {
    folders: Map<string, Tree>
    files: { file: PalaceFile; index: number; name: string }[]
    count: number
  }
  const node = (): Tree => ({ folders: new Map(), files: [], count: 0 })
  const root = node()
  files.forEach((file, index) => {
    const displayPath =
      group === 'core' ? file.path.replace(/^system\//, '') : file.path.replace(/^projects\//, '')
    const parts = displayPath.split('/')
    let current = root
    current.count++
    for (const part of parts.slice(0, -1)) {
      let child = current.folders.get(part)
      if (!child) {
        child = node()
        current.folders.set(part, child)
      }
      child.count++
      current = child
    }
    current.files.push({ file, index, name: parts.at(-1) ?? file.path })
  })
  const tree = (current: Tree): string => {
    const folders = [...current.folders]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([name, child]) =>
          `<details class="tree-dir" open><summary class="tree-item dir"><span class="tree-file-name">${escape(name)}/</span><span class="dir-count">${child.count}</span></summary><div class="tree-children">${tree(child)}</div></details>`,
      )
      .join('')
    return (
      folders +
      current.files
        .map(({ file, index, name }) => {
          const cleanName = name.replace(/\.md$/, '')
          const sizeLabel = formatBytes(file.bytes)
          return compact
            ? `<div class="tree-item file-list-entry"><span class="tree-file-name">${escape(cleanName)}</span><span class="file-chars">${sizeLabel}</span></div>`
            : `<label class="tree-item file" for="${group}-file-${index}"><span class="tree-file-name">${escape(cleanName)}</span><span class="file-chars">${sizeLabel}</span></label>`
        })
        .join('')
    )
  }
  const structure = handoff.diagnostic.structure
  const historyEntries = visibleHistoryEntries(handoff)
  const commitForFile = (path: string) =>
    historyEntries.find((entry) => {
      const lines = (entry.diff ?? '').split('\n')
      return lines.includes(`+++ ${path}`) || lines.includes(`--- ${path}`)
    }) ?? historyEntries[0]
  const documents = (compact ? [] : files)
    .map((file, index) => {
      const latest = commitForFile(file.path)
      const body = file.body === undefined ? undefined : utf8Preview(file.body, previewBytes)
      const parsed = frontmatter(body ?? '')
      const pills = [
        ...parsed.badges.map(
          ([key, value]) =>
            `<span class="meta-pill">${escape(key)}: <strong>${escape(value)}</strong></span>`,
        ),
        `<span class="meta-pill">size: <strong>${displayCount(file.bytes)} B</strong></span>`,
      ].join('')
      const truncated = file.bodyTruncated || body !== file.body
      const notice = truncated ? '<p class="note">Committed body (truncated)</p>' : ''
      return `<article class="file-document"><input class="file-radio" type="radio" name="${group}-file" id="${group}-file-${index}"${index === 0 ? ' checked' : ''} aria-label="${escape(file.path)}"><div class="file-content">
<label class="file-last-commit" for="view-history"><span class="lc-hash">${escape((latest?.revision ?? structure.revision).slice(0, 7))}</span><span class="lc-msg">${escape(latest?.subject ?? 'Committed snapshot')}</span><time class="lc-meta" datetime="${escape(latest?.committedAt ?? handoff.diagnostic.context.capturedAt)}">${escape(formatShortDate(latest?.committedAt ?? handoff.diagnostic.context.capturedAt))}</time></label>
<div class="file-meta"><div class="file-path"><code>${escape(file.path)}</code></div><div class="meta-row">${pills}</div><input class="raw-toggle-input" type="checkbox" id="raw-${group}-${index}"><label class="raw-toggle" for="raw-${group}-${index}">Raw</label></div>
<div class="file-body">${body === undefined ? '<p>No preview available.</p>' : markdown(parsed.text)}${notice}</div>
<div class="file-body-raw"><pre>${escape(body ?? '')}</pre>${notice}</div>
</div></article>`
    })
    .join('')
  const fallback =
    compact && files.length
      ? `<p class="notice">omitted to fit the HTML budget: noninteractive file list (${files.length} files).</p>${files.map((file) => `<details><summary>Committed body${file.bodyTruncated ? ' (truncated)' : ''}: <code>${escape(file.path)}</code></summary><pre>${escape(utf8Preview(file.body ?? '', previewBytes))}</pre></details>`).join('')}`
      : '<p class="lede">No files in this section.</p>'
  return `<div class="files-layout"><aside class="panel tree-panel" aria-label="${group} files"><div class="tree-desc">${group === 'core' ? 'Memory stored in-context' : 'Memory stored out-of-context'}</div>${tree(root) || '<p class="lede">No files.</p>'}</aside><div class="panel file-panel" aria-label="Selected ${group} document">${documents || fallback}</div></div>`
}

function allocateContextBlocks(counts: readonly number[]): number[] {
  const total = counts.reduce((sum, count) => sum + count, 0)
  if (total <= 0) return counts.map((_, index) => (index === counts.length - 1 ? contextBlockCount : 0))
  const rows = counts.map((count) => {
    const exact = (count / total) * contextBlockCount
    return { count, floor: Math.floor(exact), frac: exact - Math.floor(exact) }
  })
  const blocks = rows.map((row) => row.floor)
  let left = contextBlockCount - blocks.reduce((sum, count) => sum + count, 0)
  const order = rows
    .map((row, index) => ({ index, frac: row.frac, count: row.count }))
    .sort((a, b) => b.frac - a.frac || b.count - a.count || a.index - b.index)
  for (const slot of order) {
    if (left <= 0) break
    blocks[slot.index] += 1
    left -= 1
  }
  for (let index = 0; index < blocks.length; index++) {
    if (counts[index] <= 0 || blocks[index] > 0) continue
    const donor = blocks.findIndex((value, donorIndex) => donorIndex !== index && value > 1)
    if (donor < 0) break
    blocks[donor] -= 1
    blocks[index] = 1
  }
  return blocks
}

function contextView(
  handoff: PalaceHandoff,
  core: readonly PalaceFile[],
  external: readonly PalaceFile[],
): string {
  const context = handoff.diagnostic.context
  const structure = handoff.diagnostic.structure
  const coreBytes = core.reduce((sum, file) => sum + file.bytes, 0)
  const externalBytes = external.reduce((sum, file) => sum + file.bytes, 0)
  const promptBytes = context.effectiveSystemPrompt.available ? context.effectiveSystemPrompt.utf8Bytes : 0
  const projectionBytes = context.memoryProjection?.emittedBlockUtf8Bytes ?? coreBytes
  const baseSystemBytes = Math.max(0, promptBytes - projectionBytes)

  const coreTokens = coreBytes > 0 ? Math.max(1, Math.round(coreBytes / 4)) : 0
  const externalTokens = externalBytes > 0 ? Math.max(1, Math.round(externalBytes / 4)) : 0
  const systemTokens = baseSystemBytes > 0 ? Math.max(1, Math.round(baseSystemBytes / 4)) : 0
  const windowTokens =
    context.usage.available && context.usage.contextWindow ? context.usage.contextWindow : 200_000
  const measuredTokens =
    context.usage.available && context.usage.tokens !== null ? context.usage.tokens : null
  const usedTokens = Math.max(measuredTokens ?? 0, systemTokens + coreTokens)
  const messagesTokens = Math.max(0, usedTokens - systemTokens - coreTokens)
  const freeTokens = Math.max(0, windowTokens - usedTokens - externalTokens)

  const counts: Record<ContextKey, number> = {
    system: systemTokens,
    core: coreTokens,
    external: externalTokens,
    messages: messagesTokens,
    free: freeTokens,
  }
  const allocated = allocateContextBlocks(contextKeys.map((key) => counts[key]))
  const grid = contextKeys
    .flatMap((key, index) =>
      Array.from(
        { length: allocated[index] ?? 0 },
        () => `<span class="block ctx-${key}" data-cat="${key}">${contextSymbol[key]}</span>`,
      ),
    )
    .join('')

  const model = context.model ? `${context.model.provider}/${context.model.id}` : structure.project
  const fillStep = Math.max(0, Math.min(100, Math.round((usedTokens / windowTokens) * 100)))
  const usageLabel =
    measuredTokens !== null
      ? `${displayCount(usedTokens)} / ${displayCount(windowTokens)} tokens (${((usedTokens / windowTokens) * 100).toFixed(1)}%)`
      : `${formatBytes(coreBytes + externalBytes)} memory (${core.length + external.length} files)`
  const barText =
    measuredTokens !== null
      ? `${displayCount(freeTokens)} tokens available`
      : `${displayCount(core.length)} core · ${displayCount(external.length)} external`

  const legendItems = [
    counts.system > 0
      ? `<div class="ctx-legend-item" data-legend="system"><span class="ctx-legend-sym ctx-system" aria-hidden="true">${contextSymbol.system}</span><span class="ctx-legend-name">${contextLabel.system}</span><span class="ctx-legend-value">~${displayCount(counts.system)} tok</span></div>`
      : '',
    `<label class="ctx-legend-item" for="view-core" data-legend="core"><span class="ctx-legend-sym ctx-core" aria-hidden="true">${contextSymbol.core}</span><span class="ctx-legend-name">${contextLabel.core}<span class="ctx-legend-arrow" aria-hidden="true">→</span></span><span class="ctx-legend-value">${core.length} files (${formatBytes(coreBytes)})</span></label>`,
    `<label class="ctx-legend-item" for="view-external" data-legend="external"><span class="ctx-legend-sym ctx-external" aria-hidden="true">${contextSymbol.external}</span><span class="ctx-legend-name">${contextLabel.external}<span class="ctx-legend-arrow" aria-hidden="true">→</span></span><span class="ctx-legend-value">${external.length} files (${formatBytes(externalBytes)})</span></label>`,
    counts.messages > 0
      ? `<div class="ctx-legend-item" data-legend="messages"><span class="ctx-legend-sym ctx-messages" aria-hidden="true">${contextSymbol.messages}</span><span class="ctx-legend-name">${contextLabel.messages}</span><span class="ctx-legend-value">~${displayCount(counts.messages)} tok</span></div>`
      : '',
    `<div class="ctx-legend-item" data-legend="free"><span class="ctx-legend-sym ctx-free" aria-hidden="true">${contextSymbol.free}</span><span class="ctx-legend-name">${contextLabel.free}</span><span class="ctx-legend-value">${((freeTokens / windowTokens) * 100).toFixed(1)}%</span></div>`,
  ].join('')

  return `<div class="panel context-panel"><div class="context-layout"><div class="context-grid-area"><div class="context-grid" aria-hidden="true">${grid}</div></div><aside class="context-sidebar"><div class="ctx-model">${escape(model)}</div><div class="ctx-model-sub">${escape(structure.project)} · ${escape(structure.revision.slice(0, 7))}</div><div class="ctx-usage-label">${escape(usageLabel)}</div><div class="ctx-bar-track" aria-hidden="true"><div class="ctx-bar-fill ctx-fill-${fillStep}"></div></div><div class="ctx-bar-text">${escape(barText)}</div><div class="ctx-legend-title">Composition</div>${legendItems}</aside></div></div>`
}

function visibleHistoryEntries(handoff: PalaceHandoff) {
  return handoff.history.entries.filter(
    (entry) =>
      entry.changedFiles > 0 || Boolean(entry.diff) || entry.subject === 'Out-of-scope project update',
  )
}

function commitCards(
  handoff: PalaceHandoff,
  previewBytes: number,
  previewLines: number,
  compact: boolean,
): string {
  const entries = visibleHistoryEntries(handoff)
  if (!entries.length) return '<div class="panel"><p class="lede">No commits yet.</p></div>'
  return `<div class="history-toolbar"><span class="history-search-status">${entries.length} recent commit${entries.length === 1 ? '' : 's'}</span></div><div class="commit-list">${entries
    .map((entry, index) => {
      const preview = utf8Preview(entry.diff ?? '', previewBytes)
      const lines = preview.split('\n').slice(0, previewLines)
      const truncated = entry.diffTruncated || preview !== (entry.diff ?? '') || lines.join('\n') !== preview
      const returnedLines = (entry.diff ?? '').split('\n')
      const added = returnedLines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length
      const removed = returnedLines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length
      const total = added + removed
      const addBlocks = total ? Math.round((added / total) * 5) : 0
      const blocks = Array.from(
        { length: 5 },
        (_, block) => `<i class="db-block${total ? (block < addBlocks ? ' add' : ' del') : ''}"></i>`,
      ).join('')
      const diff = lines
        .map((line) => {
          const kind = line.startsWith('@@')
            ? 'hunk'
            : line.startsWith('+++') || line.startsWith('---')
              ? 'diff-file-header'
              : line.startsWith('+')
                ? 'add'
                : line.startsWith('-')
                  ? 'del'
                  : ''
          return `<span class="diff-line ${kind}">${escape(line)}</span>`
        })
        .join('')
      return `<details class="commit-item"${index === 0 && !compact ? ' open' : ''}><summary class="commit-head"><span class="commit-left"><span class="commit-hash">${escape(entry.revision.slice(0, 7))}</span><span class="diff-bar"><span class="db-plus">+${added}</span><span class="db-minus">−${removed}</span><span class="db-blocks">${blocks}</span></span></span><span class="commit-center"><span class="commit-title">${escape(entry.subject)}</span><span class="commit-preview">${entry.changedFiles} file${entry.changedFiles === 1 ? '' : 's'} changed</span></span><time class="commit-meta" datetime="${escape(entry.committedAt)}">${escape(formatShortDate(entry.committedAt))}</time></summary><div class="commit-body"><pre>${entry.diff ? diff : '<span class="diff-line">No diff preview.</span>'}</pre>${truncated ? '<p class="note">Commit diff (truncated)</p>' : ''}</div></details>`
    })
    .join('')}</div>`
}

function formatBytes(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k B`
  return `${value} B`
}

function formatShortDate(iso: string): string {
  return iso.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
}

function displayCount(value: number | null): string {
  return value === null ? 'Unknown' : new Intl.NumberFormat('en-US').format(value)
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === '&') return '&amp;'
    if (character === '<') return '&lt;'
    if (character === '>') return '&gt;'
    if (character === '"') return '&quot;'
    return '&#39;'
  })
}
