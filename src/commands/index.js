import * as character from './character.js';
import * as gear from './gear.js';
import * as expedition from './expedition.js';
import * as bid from './bid.js';
import * as island from './island.js';
import * as market from './market.js';
import * as gem from './gem.js';
import * as help from './help.js';
import * as equip from './equip.js';
import * as accessory from './accessory.js';
import * as stone from './stone.js';
import * as bracelet from './bracelet.js';
import * as skills from './skills.js';
import * as arkpassive from './arkpassive.js';
import * as arkgrid from './arkgrid.js';
import * as avatar from './avatar.js';
import * as collectible from './collectible.js';
import * as power from './power.js';
import * as emoticon from './emoticon.js';
import * as gemsof from './gemsof.js';
import * as gemboard from './gemboard.js';
import * as engraving from './engraving.js';
import * as engravingRank from './engraving-rank.js';
import * as engravingRankRelic from './engraving-rank-relic.js';
import * as engravingRankLegend from './engraving-rank-legend.js';
import * as info from './info.js';
import * as crit from './crit.js';
import * as dealshare from './dealshare.js';
import * as dealcut from './dealcut.js';
import * as life from './life.js';
import * as events from './events.js';
import * as notices from './notices.js';
import * as raidgold from './raidgold.js';
import * as weekly from './weekly.js';
import * as synergy from './synergy.js';
import * as tankiness from './tankiness.js';
import * as hell from './hell.js';
import * as naraka from './naraka.js';
import * as efficiency from './efficiency.js';
import * as grinding from './grinding.js';
import * as cores from './cores.js';
import * as paradise from './paradise.js';
import * as skillcode from './skillcode.js';
import * as guardian from './guardian.js';
import * as alarm from './alarm.js';
import * as register from './register.js';
import * as lopec from './lopec.js';
import * as alt from './alt.js';
import * as gemEfficiency from './gem-efficiency.js';
import * as update from './update.js';
import * as cpm from './cpm.js';
import * as ranking from './ranking.js';
import * as tier from './tier.js';

import { ALIASES } from '../text-commands.js';

const base = [
  character, info, gear, expedition, bid, island, market, gem, help,
  equip, accessory, stone, bracelet, skills, arkpassive, arkgrid,
  avatar, collectible, power, crit, emoticon,
  gemsof, gemboard, engraving, engravingRank, engravingRankRelic, engravingRankLegend,
  life, events, notices,
  raidgold, weekly, synergy, tankiness, hell, naraka, efficiency, dealshare, dealcut,
  grinding, cores, paradise, skillcode, guardian, alarm, register, lopec, alt, gemEfficiency, update, cpm, ranking, tier,
];

// 초성 별칭을 슬래시 커맨드로도 등록한다 (/ㅂㅂㄱ 등).
// 대상 커맨드의 옵션 구조를 그대로 복제하고 이름만 바꾼다.
const aliasCommands = Object.entries(ALIASES).flatMap(([alias, def]) => {
  const target = base.find((c) => c.data.name === def.cmd);
  if (!target) return [];
  return [{
    data: {
      name: alias,
      toJSON: () => ({ ...target.data.toJSON(), name: alias, description: `${def.cmd} 축약 커맨드` }),
    },
    execute: target.execute,
  }];
});

export const commands = [...base, ...aliasCommands];
