from fastapi.testclient import TestClient
from main import app, GridConfig
import numpy as np

client = TestClient(app)

def test_solve_endpoint():
    response = client.post("/solve", json={
        "width": 3,
        "height": 3,
        "start": [0, 0],
        "goal": [2, 2],
        "obstacles": [[1, 1]],
        "slip_prob": 0.0,
        "gamma": 0.9
    })
    assert response.status_code == 200
    data = response.json()
    assert "values" in data
    assert "policy" in data
    assert len(data["values"]) == 3
    assert len(data["values"][0]) == 3
    
    # Check goal value
    assert data["values"][2][2] == 1.0

if __name__ == "__main__":
    test_solve_endpoint()
    print("Tests passed!")
