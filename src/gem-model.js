// 한 보석 교체의 스킬 효과와 전체 장착 보석의 공격력 증가분을 계산한다.
import { findBuild, SKILL_SHARES } from './data/skill-shares.js';
import { GEM_STATS } from './data/gems.js';

const failed = (reason) => ({ gainPercent: null, reason });
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isName = (value) => typeof value === 'string' && value.trim().length > 0;
const isLevel = (value) => Number.isInteger(value) && value >= 1 && value <= 10;
const isType = (value) => value === '피해' || value === '쿨감';
const isPercent = (value) => Number.isFinite(value) && value >= 0;
const currentStat = (gem, key) => Object.hasOwn(gem, key) ? gem[key] : GEM_STATS[gem.level]?.[key];

export function estimateGemGain(input) {
  // 외부 자료의 잘못된 형태도 호출자에게 예외를 전파하지 않는다.
  try {
    if (!isRecord(input)) return failed('잘못된 입력');
    const { className, nodeNames, skills, gems, change } = input;
    if (!isName(className) || !Array.isArray(nodeNames) || !nodeNames.every(isName)
        || !Array.isArray(skills) || !Array.isArray(gems) || !isRecord(change)) {
      return failed('잘못된 입력');
    }
    if (!Object.hasOwn(SKILL_SHARES, className) || !Array.isArray(SKILL_SHARES[className])) {
      return failed('직업 자료 없음');
    }
    const build = findBuild(className, nodeNames);
    if (!build) return failed('빌드 미판별');
    const { skill, type, from, to } = change;
    if (!isName(skill) || !isLevel(from) || !isLevel(to)) return failed('잘못된 보석 변경');
    if (!isType(type)) return failed('보석 종류 미지');
    if (!isRecord(build.shares) || !Object.hasOwn(build.shares, skill)) return failed('스킬 자료 없음');
    const shares = Object.values(build.shares);
    const totalShare = shares.reduce((sum, value) => sum + value, 0);
    const cooldownUse = build.cooldownUse === undefined ? 1 : build.cooldownUse;
    if (!shares.every((value) => isPercent(value) && value <= 100)
        || !Number.isFinite(totalShare) || totalShare > 100
        || !isPercent(cooldownUse) || cooldownUse > 1 || !isName(build.build)) {
      return failed('빌드 자료 오류');
    }
    if (!skills.every((entry) => isRecord(entry) && isName(entry.Name)
        && Number.isFinite(entry.Level) && entry.Level >= 0
        && Array.isArray(entry.Tripods)
        && entry.Tripods.every((tripod) => isRecord(tripod) && typeof tripod.IsSelected === 'boolean'))) {
      return failed('스킬 입력 오류');
    }
    const matchingSkills = skills.filter((entry) => entry.Name === skill);
    if (matchingSkills.length > 1) return failed('스킬 입력 중복');
    const learned = matchingSkills[0];
    const unused = learned && learned.Level <= 1 && !learned.Tripods.some((tripod) => tripod.IsSelected);
    const weight = unused ? 0 : build.shares[skill] / 100;

    let target;
    let matchingEffects = 0;
    let attackBefore = 0;
    for (const gem of gems) {
      if (!isRecord(gem) || !isName(gem.skill) || !isLevel(gem.level)) return failed('보석 입력 오류');
      if (!isType(gem.type)) return failed('보석 종류 미지');
      for (const key of ['damagePercent', 'cooldownPercent', 'attackPercent']) {
        if (Object.hasOwn(gem, key) && (!isPercent(gem[key]) || (key === 'cooldownPercent' && gem[key] >= 100))) {
          return failed('보석 효과 오류');
        }
      }
      const attack = currentStat(gem, 'attackPercent');
      if (!isPercent(attack)) return failed('보석 수치 자료 없음');
      attackBefore += attack / 100;
      if (gem.skill === skill && gem.type === type) {
        if (++matchingEffects > 1) return failed('대상 보석 중복');
        if (gem.level === from) target = gem;
      }
    }
    if (!target) return failed('대상 보석 없음');
    const key = type === '피해' ? 'damagePercent' : 'cooldownPercent';
    const beforePercent = currentStat(target, key);
    const afterPercent = to === from ? beforePercent : GEM_STATS[to]?.[key];
    const attackAfterPercent = to === from ? currentStat(target, 'attackPercent') : GEM_STATS[to]?.attackPercent;
    if (![beforePercent, afterPercent, attackAfterPercent].every(isPercent)) return failed('보석 수치 자료 없음');
    if (type === '쿨감' && (beforePercent >= 100 || afterPercent >= 100)) return failed('보석 효과 오류');
    const before = beforePercent / 100;
    const after = afterPercent / 100;
    const attackAfter = attackBefore - currentStat(target, 'attackPercent') / 100 + attackAfterPercent / 100;
    const attackDenominator = 1 + attackBefore;
    const skillDenominator = type === '피해' ? 1 + before : 1 - after;
    if (![attackBefore, attackAfter, attackDenominator, skillDenominator].every(Number.isFinite)
        || attackBefore < 0 || attackAfter < 0 || attackDenominator <= 0 || skillDenominator <= 0) {
      return failed('보석 계산 범위 오류');
    }
    const skillGain = type === '피해'
      ? weight * ((1 + after) / skillDenominator - 1)
      : weight * cooldownUse * ((1 - before) / skillDenominator - 1);
    const attackGain = (1 + attackAfter) / attackDenominator - 1;
    const gainPercent = (skillGain + attackGain) * 100;
    const parts = { skill: skillGain * 100, attack: attackGain * 100 };
    if (![gainPercent, parts.skill, parts.attack].every(Number.isFinite)) return failed('보석 계산 범위 오류');
    return { gainPercent, parts, build: build.build };
  } catch {
    return failed('잘못된 입력');
  }
}
