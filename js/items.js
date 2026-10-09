// アイテムの一覧（アイテムボックス・図鑑のもと）。アイテムを増やすときは ITEMS に 1 つ足す。
// - id：持っている数を記録するときの名前（groups/{id}/bonus/{uid}.tickets[id]。金銀銅のチケットと同じ場所）。あとから変えない
// - name：名前、icon：絵文字、image：画像のパス（あれば絵文字の代わりに出す。例 'img/items/bronze.png'。GitHub Pages に置くので無料）
// - description：説明、rarity：レアリティ（1〜5。RARITIES）
// - kind：'ticket'（ごほうび・両替・換金に使うチケット）など
// 持てる数は 1 種類あたり ITEM_MAX まで

export const ITEM_MAX = 99999;

export const RARITIES = {
  1: { name: 'コモン', color: '#8a8f98' },
  2: { name: 'アンコモン', color: '#3f9e5a' },
  3: { name: 'レア', color: '#3b7ddd' },
  4: { name: 'エピック', color: '#9b4fd6' },
  5: { name: 'レジェンド', color: '#e0a100' },
};

export const ITEMS = [
  {
    id: 'bronze',
    name: 'ブロンズチケット',
    short: 'ブロンズ',
    icon: '🥉',
    image: '',
    rarity: 1,
    kind: 'ticket',
    description: '毎日のログインや、予定をがんばったときにもらえる、いちばん基本のチケット。ごほうびと交換したり、まとめてシルバーに両替したりできる。',
  },
  {
    id: 'silver',
    name: 'シルバーチケット',
    short: 'シルバー',
    icon: '🥈',
    image: '',
    rarity: 3,
    kind: 'ticket',
    description: 'ちょっと特別な日にもらえるチケット。7 回目・14 回目などのログインや、みんなでの予定の報酬で手に入る。',
  },
  {
    id: 'gold',
    name: 'ゴールドチケット',
    short: 'ゴールド',
    icon: '🥇',
    image: '',
    rarity: 4,
    kind: 'ticket',
    description: 'とても貴重なチケット。その月の 28 回目のログインや、特別なイベントの報酬で手に入る。',
  },
];

export const itemOf = (id) => ITEMS.find((i) => i.id === id) ?? null;

// 持っている数に足す（上限 ITEM_MAX）。inv は { id: 数 }。新しいオブジェクトを返す
export function addToInventory(inv, add) {
  const out = { ...(inv ?? {}) };
  for (const [id, n] of Object.entries(add ?? {})) {
    if (!(n > 0)) continue;
    out[id] = Math.min(ITEM_MAX, (out[id] ?? 0) + n);
  }
  return out;
}
