# Intelligent Warehouse Robot Navigation Using MDP and Value Iteration

This project is a group project implementation of a Reinforcement Learning application. It uses a Markov Decision Process (MDP) and the Value Iteration algorithm to find the optimal policy for a robot navigating a warehouse grid, dodging obstacles, and reaching a goal.

## Project Structure

The project is divided into a frontend (Next.js) and a backend (FastAPI):

*   **`frontend/`**: Contains the Next.js web application with a Tailwind CSS UI for visualizing the grid, configuring parameters, and animating the robot.
*   **`backend/`**: Contains the FastAPI Python application that implements the core Value Iteration math and logic.

## Prerequisites

*   Python 3.12+
*   Node.js 18+
*   npm

## Getting Started

### 1. Start the Backend (FastAPI)

Open a terminal and run the following commands:

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The backend API will be available at `http://localhost:8000`.

### 2. Start the Frontend (Next.js)

Open a second terminal and run the following commands:

```bash
cd frontend
npm install
npm run dev
```

The frontend application will be available at `http://localhost:3000`.

## Features and Usage

1.  **Configure the Grid**: Use the **Settings** sidebar to adjust the Grid Size (Width x Height), the Slip Probability (transition noise), and the Discount Factor ($\gamma$).
2.  **Edit the Environment**: Use the **Editor Mode** buttons to set the start location, set the goal location, toggle obstacles, or set **Custom Rewards** on the grid by clicking on cells.
3.  **Solve**:
    *   Click **Solve Instantly** to run Value Iteration until convergence and instantly see the optimal policy (arrows) and state values on the MDP grid.
    *   Click **Step Algorithm** to watch the Value Iteration algorithm update the state values iteration by iteration.
4.  **Run Simulation Side-by-Side**: Once a policy is calculated, click **Run Simulation Side-by-Side** to animate the robots. The UI will show a **Greedy Baseline Robot** (which blindly steps toward the goal coordinate) competing alongside the **MDP Smart Robot** (which follows the mathematically proven optimal policy).
5.  **Reward Tracking**: Real-time counters track the accumulating total reward and flash the step reward as the robots navigate the stochastic environment.

## Mathematical Formulation

*   **States ($S$)**: Each valid grid cell $(x, y)$ that is not an obstacle.
*   **Actions ($A$)**: Up, Right, Down, Left.
*   **Transition Model ($T(s' | s, a)$)**: The robot moves in the intended direction with probability `1 - slip_prob`. It slips to the adjacent orthogonal directions with probability `slip_prob / 2` each. If a movement leads to an obstacle or a wall, the robot stays in its current state.
*   **Rewards ($R(s)$)**: 
    *   Reaching the goal: `+1.0`
    *   Hitting an obstacle (in visualization, obstacles act as walls, but if occupied, give penalty): `-1.0`
    *   Custom Cell Reward: Variable (e.g. -50 to create a hazard)
    *   Every other step: `-0.04` (to encourage taking the shortest path)
*   **Value Iteration**: The backend iteratively updates the value of each state using the Bellman Optimality Equation:
    $$V_{k+1}(s) = \max_a \sum_{s'} T(s'|s,a) [R(s') + \gamma V_k(s')]$$
