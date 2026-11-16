import { describe, it, expect } from 'vitest';
import { Game, deriveState, computeSettlement, previewCashout, roundToSum, proportionalAdjust } from '../src/logic';

let n = 0; const id = () => 'e' + (n++);
function game(): Game {
  return { id: 'g', name: 't', createdAt: 0, startedAt: 0, endedAt: null, status: 'running',
    players: [{id:'a',name:'Anna'},{id:'b',name:'Ben'},{id:'c',name:'Cem'}], events: [], final: null, settleMode: 'overview' };
}
describe('logic', () => {
  it('buyins, payments, open', () => {
    const g = game();
    g.events.push({id:id(),at:1,type:'buyin',playerId:'a',amount:50,paid:true});
    g.events.push({id:id(),at:1,type:'buyin',playerId:'a',amount:30,paid:false});
    g.events.push({id:'p1',at:1,type:'payment',playerId:'a',amount:10});
    const s = deriveState(g);
    const a = s.players[0];
    expect([a.totalIn,a.paidCash,a.open]).toEqual([80,60,20]);
    expect(s.cashBox).toBe(60); expect(s.totalIn).toBe(80);
    g.events.push({id:id(),at:2,type:'void',targetId:'p1'});
    expect(deriveState(g).players[0].open).toBe(30);
  });
  it('user example: 30 open, 50 out -> 20', () => {
    const g = game();
    g.events.push({id:id(),at:1,type:'buyin',playerId:'a',amount:30,paid:false});
    g.events.push({id:id(),at:1,type:'buyin',playerId:'b',amount:50,paid:true});
    const s = deriveState(g);
    const pv = previewCashout(s, s.players[0], 50);
    expect(pv.payoutCash).toBe(20); expect(pv.result).toBe(20);
  });
  it('full settlement with rake, tips, debts, early leaver', () => {
    const g = game();
    const add = (p:string,a:number,paid:boolean)=>g.events.push({id:id(),at:1,type:'buyin',playerId:p,amount:a,paid});
    add('a',50,true); add('b',50,true); add('c',50,false); add('c',25,true);
    g.events.push({id:id(),at:1,type:'rake',amount:7});
    g.events.push({id:id(),at:1,type:'tip',amount:3});
    // total 175, rake+tip 10 => 165 chips. Cash 125.
    // early: b leaves with 80 chips, open 0 -> 80 bar
    let s = deriveState(g);
    const pv = previewCashout(s, s.players[1], 80);
    expect(pv.payoutCash).toBe(80);
    g.events.push({id:id(),at:2,type:'cashout',playerId:'b',chips:80,payoutCash:80});
    s = deriveState(g);
    expect(s.chipsOnTable).toBe(85);
    const st = computeSettlement(g, { chips: { a: 82, c: 3 }, adjust: {}, ignoreDiff: false });
    expect(st.diff).toBe(0);
    // avail = 125-80-10 = 35. a: 82 -> settle 82; c: 3-50 = -47. sum 35.
    const a = st.rows.find(r=>r.id==='a')!, c = st.rows.find(r=>r.id==='c')!;
    expect(a.settle + c.settle).toBe(35);
    expect(Math.abs(a.settle % 5)).toBe(0); expect(Math.abs(c.settle % 5)).toBe(0);
    console.log(a.settle, c.settle, st.transfers, st.cashPayouts, st.roundingRest);
  });
  it('rake and tips counted at the end', () => {
    const g = game();
    const add = (p:string,a:number,paid:boolean)=>g.events.push({id:id(),at:1,type:'buyin',playerId:p,amount:a,paid});
    add('a',50,true); add('b',50,true); add('c',50,false); add('c',25,true);
    g.events.push({id:id(),at:2,type:'cashout',playerId:'b',chips:80,payoutCash:80});
    expect(deriveState(g).chipsOnTable).toBe(95);
    const st = computeSettlement(g, { chips: { a: 82, c: 3 }, adjust: {}, ignoreDiff: false, rake: 7, tips: 3 });
    expect(st.diff).toBe(0); expect(st.rake).toBe(7); expect(st.tips).toBe(3);
    const a = st.rows.find(r=>r.id==='a')!, c = st.rows.find(r=>r.id==='c')!;
    expect(a.settle + c.settle).toBe(35);
  });
  it('rounding keeps sum', () => {
    expect(roundToSum([1220, 3780, -5000], 500, 0).reduce((x,y)=>x+y,0)).toBe(0);
    const r = roundToSum([1220, 3780, -5000], 500, 0); console.log(r);
  });
  it('proportional', () => {
    const p = proportionalAdjust(['a','c'], {a:60,c:40}, 5);
    expect(p.a + p.c).toBeCloseTo(-5);
  });
});
