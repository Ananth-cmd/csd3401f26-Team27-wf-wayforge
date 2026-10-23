import { toNavigatorBuilding } from '../services/navigatorBuildingAdapter';
import { toNavigatorRoute } from '../services/navigatorAdapter';
import { parseWfbLinks, UnsupportedWfbError } from '../services/wfbLinks';
import type { EngineRoute } from '../types/engineRoute';

function assert(cond: boolean, message: string) {
    if (!cond) throw new Error(`FAILED: ${message}`);
}
// Single-floor actual shape, using the user's sample.
const simple = {
  version: 1, building: {name:'Backend Integration Test',id:'backend-integration-test'},
  levels:[{id:'L1',name:'Level 1',elevation:0,ceilingHeight:2.8,
    walls:[{a:[0,0],b:[20,0],thickness:0.15}], rooms:[{id:'r1',kind:'unknown',centroid:[2.5,9.5]}],
    nodes:[{id:'n1',pos:[2.5,9.5],kind:'room',room:'r1'}, {id:'n8',pos:[0,2.45],kind:'door'}],
    edges:[{a:'n1',b:'n8',cost:7.5,stepFree:true}]
  }], links:[]
};
const route1: EngineRoute = {ok:true,from:'L1:n1',to:'L1:n8',totalCost:7.5,stepFree:true,
  steps:[{level:'L1',node:'n1',kind:'room',x:2.5,y:9.5,z:0},{level:'L1',node:'n8',kind:'door',x:0,y:2.45,z:0}],directions:[]};
const converted1 = toNavigatorBuilding(simple);
assert(converted1.nodes.length === 2 && converted1.edges.length === 1 && converted1.links.length === 0, 'single-floor building');
const r1 = toNavigatorRoute(route1, simple);
assert(r1.nodes.join(',') === 'L1:n1,L1:n8' && r1.passages.join(',') === 'walk' && r1.metres === 7.5, 'single-floor route');

// Synthetic multi-floor data validates the adapter logic, NOT the real engine link format.
const multi = {
  version:1,building:{id:'three-floor-test',name:'Synthetic three floor building',floorHeight:3.5},
  levels:[1,2,3].map(i=>({id:`L${i}`,name:`Level ${i}`,elevation:(i-1)*3.5,ceilingHeight:3,
    walls:[],rooms:[{id:`r${i}`,code:`L${i}-01`,kind:'office',name:`Room ${i}`}],
    nodes:[{id:'room',pos:[0,0],kind:'room',room:`r${i}`},{id:'lift',pos:[2,0],kind:'lift'}, {id:'stair',pos:[4,0],kind:'stairs'}],
    edges:[{a:'room',b:'lift',cost:2,stepFree:true},{a:'room',b:'stair',cost:4,stepFree:true}]
  })),
  links:[
    {a:'L1:lift',b:'L2:lift',kind:'lift',cost:6,stepFree:true},
    {a:'L2:lift',b:'L3:lift',kind:'lift',cost:6,stepFree:true},
    {a:'L1:stair',b:'L2:stair',kind:'stair',cost:4,stepFree:false},
    {a:'L2:stair',b:'L3:stair',kind:'stair',cost:4,stepFree:false},
  ]
};
const converted = toNavigatorBuilding(multi);
assert(converted.levels.length === 3 && converted.links.length === 4, 'multi building links');
const liftRoute: EngineRoute = {ok:true,from:'L1:room',to:'L3:room',totalCost:16,stepFree:true,directions:[],
 steps:[{level:'L1',node:'room',kind:'room',x:0,y:0,z:0},{level:'L1',node:'lift',kind:'lift',x:2,y:0,z:0},
 {level:'L2',node:'lift',kind:'lift',x:2,y:0,z:3.5},{level:'L3',node:'lift',kind:'lift',x:2,y:0,z:7},
 {level:'L3',node:'room',kind:'room',x:0,y:0,z:7}]};
const lr = toNavigatorRoute(liftRoute,multi);
assert(lr.passages.join(',')==='walk,lift,lift,walk', 'lift route');
const stairsRoute: EngineRoute = {ok:true,from:'L1:stair',to:'L2:stair',totalCost:4,stepFree:false,directions:[],
 steps:[{level:'L1',node:'stair',kind:'stairs',x:4,y:0,z:0},{level:'L2',node:'stair',kind:'stairs',x:4,y:0,z:3.5}]};
const sr = toNavigatorRoute(stairsRoute,multi);
assert(sr.passages[0]==='stairs','stairs route');
let rejected = false;
try { toNavigatorRoute({...stairsRoute,stepFree:true},multi); } catch(e) { rejected = e instanceof UnsupportedWfbError; }
assert(rejected, 'reject stairs in step-free response');
rejected=false;
try { parseWfbLinks([{from:'L1:lift',to:'L2:lift',kind:'escalator'}]); }catch(e) {rejected=e instanceof UnsupportedWfbError;}
assert(rejected, 'reject unknown link type');
console.log('PASS: single-floor building + route; synthetic three-floor building; lift, stairs, step-free safety, unknown kinds');
