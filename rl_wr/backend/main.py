from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Tuple, Dict
import numpy as np

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class GridConfig(BaseModel):
    width: int = Field(default=5, ge=1, le=50)
    height: int = Field(default=5, ge=1, le=50)
    start: Tuple[int, int] = Field(default=(0, 0))
    goal: Tuple[int, int] = Field(default=(4, 4))
    obstacles: List[Tuple[int, int]] = Field(default=[])
    slip_prob: float = Field(default=0.1, ge=0.0, lt=1.0)
    gamma: float = Field(default=0.9, ge=0.0, le=1.0)
    reward_step: float = Field(default=-0.04)
    reward_goal: float = Field(default=1.0)
    reward_obstacle: float = Field(default=-1.0)
    custom_rewards: List[Tuple[int, int, float]] = Field(default=[])
    max_iterations: int = Field(default=1000)
    theta: float = Field(default=1e-4)

class StepConfig(BaseModel):
    config: GridConfig
    V: List[List[float]]

# Actions: 0: Up, 1: Right, 2: Down, 3: Left
# (dx, dy) mapping - visual coordinates, so y increases downwards (0,0 is top-left)
ACTION_VECTORS = {
    0: (0, -1), # Up
    1: (1, 0),  # Right
    2: (0, 1),  # Down
    3: (-1, 0)  # Left
}

def is_valid_state(x, y, width, height):
    return 0 <= x < width and 0 <= y < height

def get_next_state(x, y, action, width, height, obstacles):
    dx, dy = ACTION_VECTORS[action]
    nx, ny = x + dx, y + dy
    if is_valid_state(nx, ny, width, height) and (nx, ny) not in obstacles:
        return nx, ny
    return x, y

def compute_transition_probs(x, y, action, width, height, obstacles, slip_prob):
    transitions = []
    
    # intended action
    intended_prob = 1.0 - slip_prob
    nx, ny = get_next_state(x, y, action, width, height, obstacles)
    
    prob_map = {}
    prob_map[(nx, ny)] = prob_map.get((nx, ny), 0) + intended_prob
    
    if slip_prob > 0:
        # slip actions (orthogonal)
        slip_action_1 = (action + 1) % 4
        slip_action_2 = (action - 1) % 4
        
        nx1, ny1 = get_next_state(x, y, slip_action_1, width, height, obstacles)
        prob_map[(nx1, ny1)] = prob_map.get((nx1, ny1), 0) + (slip_prob / 2.0)
        
        nx2, ny2 = get_next_state(x, y, slip_action_2, width, height, obstacles)
        prob_map[(nx2, ny2)] = prob_map.get((nx2, ny2), 0) + (slip_prob / 2.0)
    
    for (state_x, state_y), prob in prob_map.items():
        if prob > 0:
            transitions.append((prob, state_x, state_y))
            
    return transitions

def get_reward(x, y, config: GridConfig, custom_rewards_map: dict = None):
    if custom_rewards_map is None:
        custom_rewards_map = {(rx, ry): r for rx, ry, r in config.custom_rewards}
    if (x, y) in custom_rewards_map:
        return custom_rewards_map[(x, y)]
    if (x, y) == tuple(config.goal):
        return config.reward_goal
    if (x, y) in [tuple(obs) for obs in config.obstacles]:
        return config.reward_obstacle
    return config.reward_step

def compute_action_values(x, y, V, config: GridConfig, obstacles_set, custom_rewards_map):
    action_values = []
    for a in range(4):
        transitions = compute_transition_probs(x, y, a, config.width, config.height, obstacles_set, config.slip_prob)
        val = 0
        for prob, nx, ny in transitions:
            val += prob * (get_reward(nx, ny, config, custom_rewards_map) + config.gamma * V[nx, ny])
        action_values.append(val)
    return action_values

@app.post("/solve")
def solve_mdp(config: GridConfig):
    width, height = config.width, config.height
    V = np.zeros((width, height))
    policy = np.zeros((width, height), dtype=int)
    
    obstacles_set = set(tuple(obs) for obs in config.obstacles)
    goal = tuple(config.goal)
    custom_rewards_map = {(rx, ry): r for rx, ry, r in config.custom_rewards}
    
    for _ in range(config.max_iterations):
        delta = 0
        V_new = np.copy(V)
        
        for x in range(width):
            for y in range(height):
                if (x, y) == goal or (x, y) in obstacles_set:
                    V_new[x, y] = get_reward(x, y, config, custom_rewards_map)
                    continue
                
                action_values = compute_action_values(x, y, V, config, obstacles_set, custom_rewards_map)
                best_action_val = max(action_values)
                V_new[x, y] = best_action_val
                delta = max(delta, abs(V[x, y] - V_new[x, y]))
                
        V = V_new
        if delta < config.theta:
            break
            
    for x in range(width):
        for y in range(height):
            if (x, y) == goal or (x, y) in obstacles_set:
                continue
            
            action_values = compute_action_values(x, y, V, config, obstacles_set, custom_rewards_map)
            policy[x, y] = np.argmax(action_values)

    return {
        "values": V.tolist(),
        "policy": policy.tolist(),
        "iterations": _ + 1
    }

@app.post("/step")
def step_mdp(step_config: StepConfig):
    config = step_config.config
    width, height = config.width, config.height
    V = np.array(step_config.V)
    if V.shape != (width, height):
        V = np.zeros((width, height))
        
    policy = np.zeros((width, height), dtype=int)
    V_new = np.copy(V)
    
    obstacles_set = set(tuple(obs) for obs in config.obstacles)
    goal = tuple(config.goal)
    custom_rewards_map = {(rx, ry): r for rx, ry, r in config.custom_rewards}
    delta = 0
    
    for x in range(width):
        for y in range(height):
            if (x, y) == goal or (x, y) in obstacles_set:
                V_new[x, y] = get_reward(x, y, config, custom_rewards_map)
                continue
            
            action_values = compute_action_values(x, y, V, config, obstacles_set, custom_rewards_map)
            best_action_val = max(action_values)
            V_new[x, y] = best_action_val
            policy[x, y] = np.argmax(action_values)
            delta = max(delta, abs(V[x, y] - V_new[x, y]))
            
    return {
        "values": V_new.tolist(),
        "policy": policy.tolist(),
        "delta": float(delta)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5083)
