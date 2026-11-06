"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Play, Square, RotateCcw, Settings2, SkipForward, Info, MousePointer2, Bot, Cpu, Target, Flag, CircleDollarSign } from 'lucide-react';

const API_URL = 'http://localhost:5083';

type Point = [number, number];

interface GridConfig {
  width: number;
  height: number;
  start: Point;
  goal: Point;
  obstacles: Point[];
  slip_prob: number;
  gamma: number;
  reward_step: number;
  reward_goal: number;
  reward_obstacle: number;
  custom_rewards: [number, number, number][];
}

export default function Home() {
  const [config, setConfig] = useState<GridConfig>({
    width: 6,
    height: 6,
    start: [0, 0],
    goal: [5, 5],
    obstacles: [[2, 2], [2, 3], [2, 4]],
    slip_prob: 0.1,
    gamma: 0.9,
    reward_step: -0.04,
    reward_goal: 1.0,
    reward_obstacle: -1.0,
    custom_rewards: [],
  });

  const [mode, setMode] = useState<'edit_start' | 'edit_goal' | 'edit_obstacle' | 'edit_reward'>('edit_obstacle');
  const [customRewardInput, setCustomRewardInput] = useState<string>("-10");
  
  const [values, setValues] = useState<number[][]>([]);
  const [policy, setPolicy] = useState<number[][]>([]);
  const [iteration, setIteration] = useState(0);
  
  // Robot Simulation States
  const [mdpRobotPos, setMdpRobotPos] = useState<Point | null>(null);
  const [greedyRobotPos, setGreedyRobotPos] = useState<Point | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [autoIterating, setAutoIterating] = useState(false);

  // Reward Tracking
  const [mdpTotalReward, setMdpTotalReward] = useState<number>(0);
  const [greedyTotalReward, setGreedyTotalReward] = useState<number>(0);
  const [mdpStepReward, setMdpStepReward] = useState<number | null>(null);
  const [greedyStepReward, setGreedyStepReward] = useState<number | null>(null);

  useEffect(() => {
    resetGrid();
  }, [config.width, config.height]);

  const resetGrid = () => {
    const v = Array(config.width).fill(0).map(() => Array(config.height).fill(0));
    setValues(v);
    setPolicy(v);
    setIteration(0);
    resetSimulation();
  };

  const resetSimulation = () => {
    setMdpRobotPos(config.start);
    setGreedyRobotPos(config.start);
    setIsPlaying(false);
    setAutoIterating(false);
    setMdpTotalReward(0);
    setGreedyTotalReward(0);
    setMdpStepReward(null);
    setGreedyStepReward(null);
  };

  const handleCellClick = (x: number, y: number) => {
    if (mode === 'edit_start') {
      setConfig({ ...config, start: [x, y] });
      setMdpRobotPos([x, y]);
      setGreedyRobotPos([x, y]);
    } else if (mode === 'edit_goal') {
      setConfig({ ...config, goal: [x, y] });
    } else if (mode === 'edit_obstacle') {
      const isObstacle = config.obstacles.some(o => o[0] === x && o[1] === y);
      if (isObstacle) {
        setConfig({ ...config, obstacles: config.obstacles.filter(o => o[0] !== x || o[1] !== y) });
      } else {
        setConfig({ ...config, obstacles: [...config.obstacles, [x, y]] });
        // Also clear custom reward if placed here
        setConfig(prev => ({ ...prev, custom_rewards: prev.custom_rewards.filter(r => r[0] !== x || r[1] !== y)}));
      }
    } else if (mode === 'edit_reward') {
      const val = parseFloat(customRewardInput);
      if (!isNaN(val)) {
        // Remove existing custom reward for cell
        const filtered = config.custom_rewards.filter(r => r[0] !== x || r[1] !== y);
        setConfig({ ...config, custom_rewards: [...filtered, [x, y, val]], obstacles: config.obstacles.filter(o => o[0] !== x || o[1] !== y) });
      }
    }
  };

  const clearCustomReward = (x: number, y: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfig(prev => ({ ...prev, custom_rewards: prev.custom_rewards.filter(r => r[0] !== x || r[1] !== y)}));
  };

  const solveMDP = async () => {
    try {
      const res = await fetch(`${API_URL}/solve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      setValues(data.values);
      setPolicy(data.policy);
      setIteration(data.iterations);
      resetSimulation();
    } catch (err) {
      console.error(err);
    }
  };

  const stepMDP = async () => {
    try {
      const v = values.length ? values : Array(config.width).fill(0).map(() => Array(config.height).fill(0));
      const res = await fetch(`${API_URL}/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, V: v }),
      });
      const data = await res.json();
      setValues(data.values);
      setPolicy(data.policy);
      setIteration(i => i + 1);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (autoIterating) {
      interval = setInterval(stepMDP, 200);
    }
    return () => clearInterval(interval);
  }, [autoIterating, values, config]);

  const getRewardForCell = (x: number, y: number) => {
    const custom = config.custom_rewards.find(r => r[0] === x && r[1] === y);
    if (custom) return custom[2];
    if (x === config.goal[0] && y === config.goal[1]) return config.reward_goal;
    if (config.obstacles.some(o => o[0] === x && o[1] === y)) return config.reward_obstacle;
    return config.reward_step;
  };

  const simulateStep = (pos: Point, action: number): Point => {
    // Determine actual movement considering slip probability
    let actualAction = action;
    const rand = Math.random();
    if (rand < config.slip_prob) {
      // Slip to orthogonal
      if (rand < config.slip_prob / 2) {
        actualAction = (action + 1) % 4;
      } else {
        actualAction = (action + 3) % 4;
      }
    }

    let dx = 0, dy = 0;
    if (actualAction === 0) dy = -1; // Up
    if (actualAction === 1) dx = 1;  // Right
    if (actualAction === 2) dy = 1;  // Down
    if (actualAction === 3) dx = -1; // Left

    const nx = pos[0] + dx;
    const ny = pos[1] + dy;

    // Check bounds and obstacles (walls)
    const isObstacle = config.obstacles.some(o => o[0] === nx && o[1] === ny);
    if (nx >= 0 && nx < config.width && ny >= 0 && ny < config.height && !isObstacle) {
      return [nx, ny];
    }
    // Stay in place if hitting wall/obstacle
    return pos;
  };

  const getGreedyAction = (pos: Point): number => {
    const dx = config.goal[0] - pos[0];
    const dy = config.goal[1] - pos[1];
    
    // Simple greedy logic: prioritize largest delta
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? 1 : 3; // Right or Left
    } else {
      return dy > 0 ? 2 : 0; // Down or Up
    }
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying) {
      interval = setInterval(() => {
        let allDone = true;

        // --- MDP Robot ---
        if (mdpRobotPos && (mdpRobotPos[0] !== config.goal[0] || mdpRobotPos[1] !== config.goal[1])) {
          allDone = false;
          const action = policy[mdpRobotPos[0]]?.[mdpRobotPos[1]];
          if (action !== undefined) {
             const nextPos = simulateStep(mdpRobotPos, action);
             const r = getRewardForCell(nextPos[0], nextPos[1]);
             setMdpRobotPos(nextPos);
             setMdpStepReward(r);
             setMdpTotalReward(prev => prev + r);
          }
        } else {
          setMdpStepReward(null);
        }

        // --- Greedy Robot ---
        if (greedyRobotPos && (greedyRobotPos[0] !== config.goal[0] || greedyRobotPos[1] !== config.goal[1])) {
          allDone = false;
          const action = getGreedyAction(greedyRobotPos);
          const nextPos = simulateStep(greedyRobotPos, action);
          const r = getRewardForCell(nextPos[0], nextPos[1]);
          setGreedyRobotPos(nextPos);
          setGreedyStepReward(r);
          setGreedyTotalReward(prev => prev + r);
        } else {
          setGreedyStepReward(null);
        }

        if (allDone) {
          setIsPlaying(false);
        }
      }, 500);
    }
    return () => clearInterval(interval);
  }, [isPlaying, mdpRobotPos, greedyRobotPos, policy, config]);

  const renderArrow = (action: number) => {
    switch (action) {
      case 0: return '↑';
      case 1: return '→';
      case 2: return '↓';
      case 3: return '←';
      default: return '';
    }
  };

  const GridView = ({ type, robotPos, stepReward, totalReward }: { type: 'MDP' | 'Greedy', robotPos: Point | null, stepReward: number | null, totalReward: number }) => {
    return (
      <div className="flex flex-col items-center">
        <h3 className="text-xl font-bold mb-2 flex items-center gap-2 text-stone-800">
          {type === 'MDP' ? <><Cpu className="w-6 h-6 text-blue-600"/> Smart Robot (MDP)</> : <><Bot className="w-6 h-6 text-stone-500"/> Baseline (Greedy)</>}
        </h3>
        <div 
          className="grid gap-1 border-2 border-stone-800 bg-stone-800 rounded-lg p-1 shadow-lg"
          style={{ gridTemplateColumns: `repeat(${config.width}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: config.height }).map((_, y) => 
            Array.from({ length: config.width }).map((_, x) => {
              const isStart = config.start[0] === x && config.start[1] === y;
              const isGoal = config.goal[0] === x && config.goal[1] === y;
              const isObstacle = config.obstacles.some(o => o[0] === x && o[1] === y);
              const customR = config.custom_rewards.find(r => r[0] === x && r[1] === y);
              const isRobot = robotPos?.[0] === x && robotPos?.[1] === y;
              
              const val = values[x]?.[y] || 0;
              const pol = type === 'MDP' ? policy[x]?.[y] : getGreedyAction([x, y]);

              let cellContent = null;
              if (isRobot) {
                cellContent = <div className="z-10 animate-bounce drop-shadow-md">{type === 'MDP' ? <Cpu className="w-8 h-8 text-blue-800 fill-blue-100"/> : <Bot className="w-8 h-8 text-stone-600 fill-stone-200"/>}</div>;
              } else if (isStart) {
                cellContent = <div className="opacity-60 text-blue-800"><Flag className="w-6 h-6" /></div>;
              } else if (isGoal) {
                cellContent = <div className="text-green-700"><Target className="w-8 h-8" /></div>;
              } else if (type === 'MDP' && iteration > 0 && pol !== undefined && !isGoal && !isObstacle) {
                cellContent = <div className="text-stone-700 text-lg font-bold">{renderArrow(pol)}</div>;
              } else if (type === 'Greedy' && !isGoal && !isObstacle) {
                 cellContent = <div className="text-stone-400 text-lg font-bold">{renderArrow(pol)}</div>;
              }

              // Base Colors
              let bgColor = 'bg-stone-100';
              if (isObstacle) bgColor = 'bg-stone-700';
              
              // Custom Reward Highlight
              if (customR && !isObstacle && !isGoal && !isStart) {
                 if (customR[2] > 0) bgColor = 'bg-green-200 border-2 border-green-400';
                 else if (customR[2] < 0) bgColor = 'bg-red-200 border-2 border-red-400';
              }

              // MDP Value Heatmap
              if (type === 'MDP' && !isObstacle && iteration > 0 && !customR) {
                const maxVal = config.reward_goal;
                if (val > 0) {
                  const intensity = Math.min(1, val / maxVal);
                  bgColor = `rgba(134, 239, 172, ${intensity})`; // green-300
                } else if (val < 0) {
                  const intensity = Math.min(1, Math.abs(val) / Math.abs(config.reward_obstacle || 1));
                  bgColor = `rgba(252, 165, 165, ${intensity})`; // red-300
                }
              }

              return (
                <div
                  key={`${x}-${y}`}
                  onClick={() => handleCellClick(x, y)}
                  className={`w-14 h-14 sm:w-16 sm:h-16 flex flex-col items-center justify-center cursor-pointer transition-all relative rounded-sm hover:ring-2 hover:ring-blue-400 ${bgColor.startsWith('bg') ? bgColor : ''}`}
                  style={{ backgroundColor: bgColor.startsWith('rgba') ? bgColor : undefined }}
                >
                  {cellContent}
                  
                  {customR && !isObstacle && (
                    <div className="absolute top-0 right-0 m-0.5 group">
                      <span className="text-[10px] font-bold text-stone-700 bg-white/70 px-1 rounded shadow-sm">{customR[2]}</span>
                      {mode === 'edit_reward' && (
                        <button onClick={(e) => clearCustomReward(x, y, e)} className="hidden group-hover:flex absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-4 h-4 items-center justify-center text-[10px]">×</button>
                      )}
                    </div>
                  )}

                  {type === 'MDP' && !isObstacle && !isGoal && iteration > 0 && (
                    <div className="absolute bottom-0 text-[10px] text-stone-600 mb-0.5 font-mono">
                      {val.toFixed(1)}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        
        {/* Reward Tracker */}
        <div className="mt-4 w-full bg-white p-4 rounded-xl shadow border border-stone-200 text-center relative overflow-hidden">
           <div className="text-stone-500 text-sm font-semibold uppercase tracking-wider mb-1">Total Reward</div>
           <div className={`text-4xl font-black ${totalReward < 0 ? 'text-red-500' : 'text-green-600'}`}>
             {totalReward.toFixed(2)}
           </div>
           
           {/* Animated floating step reward */}
           {stepReward !== null && (
             <div key={Math.random()} className={`absolute top-1/2 left-3/4 -translate-y-1/2 -translate-x-1/2 text-2xl font-bold animate-ping-once ${stepReward < 0 ? 'text-red-400' : 'text-green-400'}`}>
               {stepReward > 0 ? '+' : ''}{stepReward.toFixed(2)}
             </div>
           )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-stone-100 p-4 sm:p-8 text-stone-800 selection:bg-blue-200">
      <div className="max-w-7xl mx-auto space-y-8">
        <header className="text-center space-y-3 pb-6 border-b border-stone-300">
          <h1 className="text-4xl sm:text-5xl font-black text-stone-900 tracking-tight">Intelligent Warehouse Navigation</h1>
          <p className="text-stone-600 text-lg">4th Year Group Project: Reinforcement Learning (Value Iteration MDP Solver)</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          
          {/* Sidebar Controls */}
          <div className="space-y-6 lg:col-span-1">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
              <h2 className="text-lg font-bold flex items-center gap-2 mb-4 text-stone-800">
                <Settings2 className="w-5 h-5 text-blue-600" /> Environment Settings
              </h2>
              <div className="space-y-5 text-sm font-medium">
                <div>
                  <label className="block text-stone-500 mb-1.5 uppercase text-xs tracking-wider">Grid Size (W x H)</label>
                  <div className="flex gap-2">
                    <input type="number" value={config.width} onChange={e => setConfig({...config, width: parseInt(e.target.value) || 1})} className="w-full border-2 border-stone-200 rounded-lg p-2 focus:border-blue-500 outline-none" />
                    <input type="number" value={config.height} onChange={e => setConfig({...config, height: parseInt(e.target.value) || 1})} className="w-full border-2 border-stone-200 rounded-lg p-2 focus:border-blue-500 outline-none" />
                  </div>
                </div>
                <div>
                  <label className="flex justify-between text-stone-500 mb-1.5 uppercase text-xs tracking-wider">
                    <span>Slip Probability</span>
                    <span className="text-blue-600 font-bold">{config.slip_prob}</span>
                  </label>
                  <input type="range" min="0" max="0.5" step="0.05" value={config.slip_prob} onChange={e => setConfig({...config, slip_prob: parseFloat(e.target.value)})} className="w-full accent-blue-600" />
                </div>
                <div>
                  <label className="flex justify-between text-stone-500 mb-1.5 uppercase text-xs tracking-wider">
                    <span>Discount Factor (γ)</span>
                    <span className="text-blue-600 font-bold">{config.gamma}</span>
                  </label>
                  <input type="range" min="0.1" max="1" step="0.05" value={config.gamma} onChange={e => setConfig({...config, gamma: parseFloat(e.target.value)})} className="w-full accent-blue-600" />
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-stone-800">
                <MousePointer2 className="w-5 h-5 text-purple-600" /> Editor Mode
              </h2>
              <div className="space-y-2">
                <button onClick={() => setMode('edit_start')} className={`w-full flex items-center gap-2 py-2.5 px-4 rounded-lg border-2 text-left font-semibold transition-all ${mode === 'edit_start' ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-inner' : 'border-transparent hover:bg-stone-100 text-stone-600'}`}><Flag className="w-4 h-4"/> Set Start Position</button>
                <button onClick={() => setMode('edit_goal')} className={`w-full flex items-center gap-2 py-2.5 px-4 rounded-lg border-2 text-left font-semibold transition-all ${mode === 'edit_goal' ? 'bg-green-50 border-green-500 text-green-700 shadow-inner' : 'border-transparent hover:bg-stone-100 text-stone-600'}`}><Target className="w-4 h-4"/> Set Goal Position</button>
                <button onClick={() => setMode('edit_obstacle')} className={`w-full flex items-center gap-2 py-2.5 px-4 rounded-lg border-2 text-left font-semibold transition-all ${mode === 'edit_obstacle' ? 'bg-stone-800 border-stone-900 text-white shadow-inner' : 'border-transparent hover:bg-stone-100 text-stone-600'}`}><div className="w-4 h-4 bg-stone-500 rounded-sm"></div> Toggle Obstacles</button>
                <div className={`p-3 rounded-lg border-2 transition-all ${mode === 'edit_reward' ? 'bg-amber-50 border-amber-500 shadow-inner' : 'border-transparent'}`}>
                  <button onClick={() => setMode('edit_reward')} className={`w-full flex items-center gap-2 text-left font-semibold mb-2 ${mode === 'edit_reward' ? 'text-amber-700' : 'text-stone-600'}`}><CircleDollarSign className="w-4 h-4"/> Set Custom Reward</button>
                  {mode === 'edit_reward' && (
                    <input type="number" step="0.5" value={customRewardInput} onChange={e => setCustomRewardInput(e.target.value)} className="w-full border-2 border-amber-300 rounded p-1.5 focus:border-amber-600 outline-none text-sm" placeholder="-10, 5, etc." />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Main Visualization Area */}
          <div className="lg:col-span-3 space-y-6">
            
            {/* Algorithm Controls */}
            <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-stone-200 flex flex-col sm:flex-row gap-4 justify-between items-center">
              <div className="flex flex-wrap gap-2 justify-center">
                <button onClick={stepMDP} className="flex items-center gap-1.5 bg-stone-100 hover:bg-stone-200 border border-stone-300 px-4 py-2 rounded-lg font-bold text-stone-700 transition-colors"><SkipForward className="w-4 h-4"/> Step Algorithm</button>
                <button onClick={() => setAutoIterating(!autoIterating)} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg font-bold border transition-colors ${autoIterating ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100' : 'bg-stone-100 border-stone-300 text-stone-700 hover:bg-stone-200'}`}>{autoIterating ? <Square className="w-4 h-4"/> : <Play className="w-4 h-4"/>} {autoIterating ? 'Stop' : 'Auto Step'}</button>
                <button onClick={solveMDP} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg font-bold shadow-md shadow-blue-200 transition-all active:scale-95">Solve Instantly</button>
                <button onClick={resetGrid} className="flex items-center gap-1.5 bg-stone-100 hover:bg-stone-200 border border-stone-300 px-4 py-2 rounded-lg font-bold text-stone-700 transition-colors ml-auto"><RotateCcw className="w-4 h-4" /> Reset</button>
              </div>
              
              <div className="bg-stone-800 text-white px-5 py-2 rounded-lg font-mono font-bold shadow-inner">
                Iter: <span className="text-blue-400">{iteration}</span>
              </div>
            </div>

            {/* Side-by-Side Grids */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
               <GridView type="Greedy" robotPos={greedyRobotPos} stepReward={greedyStepReward} totalReward={greedyTotalReward} />
               <GridView type="MDP" robotPos={mdpRobotPos} stepReward={mdpStepReward} totalReward={mdpTotalReward} />
            </div>

            {/* Simulation Controls */}
            {iteration > 0 && (
              <div className="flex justify-center mt-8 pb-8">
                <button 
                  onClick={() => {
                     if (!isPlaying) resetSimulation();
                     setIsPlaying(!isPlaying);
                  }}
                  className={`flex items-center gap-3 px-10 py-4 rounded-full font-black text-xl shadow-xl transition-all active:scale-95 ${isPlaying ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-200' : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-200'}`}
                >
                  {isPlaying ? <Square className="w-6 h-6"/> : <Play className="w-6 h-6"/>} 
                  {isPlaying ? 'Stop Simulation' : 'Run Simulation Side-by-Side'}
                </button>
              </div>
            )}
            
            <div className="bg-blue-50/50 border border-blue-100 p-5 rounded-2xl flex gap-4 text-blue-900 text-sm shadow-sm">
              <Info className="w-6 h-6 shrink-0 text-blue-500" />
              <div className="space-y-2">
                <p>
                  <strong>Comparison:</strong> The <strong>Greedy Baseline</strong> blindly steps toward the coordinates of the goal, ignoring obstacles and risks of slipping. The <strong>Smart Robot</strong> uses policies generated by the <strong>Value Iteration</strong> algorithm, which calculates the mathematical expected value $V(s)$ of every state considering transition probabilities and future rewards.
                </p>
                <p>
                  <em>Tip: Add a custom penalty (e.g. -50) near the goal to see the Smart Robot navigate around it, while the Greedy Robot dives straight in!</em>
                </p>
              </div>
            </div>

          </div>
        </div>
      </div>
      
      {/* Global styles for animation */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes ping-once {
          0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
          100% { transform: translate(-50%, -150%) scale(1.5); opacity: 0; }
        }
        .animate-ping-once {
          animation: ping-once 0.8s ease-out forwards;
        }
      `}} />
    </div>
  );
}
