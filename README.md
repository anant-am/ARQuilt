# ARQuilt — Interactive ARQ Simulation Lab

ARQuilt is an interactive, browser-based computer networking laboratory designed for demonstrating and exploring Automatic Repeat reQuest (ARQ) protocols:
- **Stop-and-Wait (SW)**
- **Go-Back-N (GBN)**
- **Selective Repeat (SR)**
- **Auto-Protocol Selector with Calibration Probe**

The simulator visualizes how files are fragmented into transport packets, serialized through an imperfect virtual network channel (with loss, delay, jitter, bit corruption, out-of-order delivery, and retransmissions), reassembled by a receiver, and verified with SHA-256 cryptographic hashes.

---

## Key Features

1. **Authentic Network Animation**:
   - Directional rails for forward **DATA** and reverse **ACK** transmission.
   - Unmistakable packet loss: lost packets travel to the channel loss zone, stop, burst into red particles, and never reach the receiver.
   - Corrupted frames reach the receiver and trigger a CRC checksum mismatch rejection.
   - Retransmissions are rendered as distinct attempts (`Try #2`, `Try #3`) starting fresh from the sender.
   - Pulsing radar timeout rings at the sender node.

2. **Interactive "Why Did This Happen?" Inspector**:
   - Click any packet, ACK, loss marker, or event log row to inspect:
     - Concerned frame and attempt number
     - Root-cause failure diagnosis
     - Exact ARQ state machine transition rule
     - Sender and receiver internal states
     - Next protocol action and remaining retry budget
     - Configured channel condition grounding

3. **16 Predefined Network Scenarios (A through P)**:
   - `s01`: Clean Fast Network
   - `s02`: High Latency, Low Loss
   - `s03`: Random DATA Loss
   - `s04`: ACK Loss (Duplicate delivery suppression)
   - `s05`: Burst Loss (Gilbert-Elliott Markov model)
   - `s06`: Corrupted Frames (CRC32 detection and rejection)
   - `s07`: Jitter & Reordering (Out-of-order buffering)
   - `s08`: Receiver Memory Limited (Rx buffer = 1)
   - `s09`: Sender Memory Limited (Tx buffer constraint)
   - `s10`: Guaranteed Failure (100% loss & retry exhaustion)
   - `s11`: Bandwidth Bottleneck (Low serialization rate)
   - `s12`: Asymmetric Forward & Reverse Channels
   - `s13`: Queue Congestion (Buffer overflow drop)
   - `s14`: Two-Hop Router Path (Multi-hop forwarding)
   - `s15`: Changing Network Conditions (Dynamic channel phases)
   - `s16`: Duplicate & Delayed Packets

4. **Reliability & No-Refresh Recovery**:
   - WebSocket streaming with 35ms event batching (eliminates UI lag and freezing).
   - Cursor-based event catchup (`since_id`) and automatic reconnection with exponential backoff.
   - Clean reset and cancel controls without requiring page reload.

5. **Cryptographic Verification**:
   - Visual reconstruction quilt and byte-exact SHA-256 hash match confirmation.

---

## Running the Application

### Backend (FastAPI + Uvicorn)
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

### Frontend (React + Vite + Tailwind CSS + Framer Motion)
```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Open your browser to `http://127.0.0.1:5173`.

---

## Running Automated Tests

### Backend Unit & Regression Suite (46 Tests)
```bash
cd backend
python -m pytest -v
```

### Live End-to-End Integration Suite
```bash
python test_e2e_full.py
```

### Frontend Production Build
```bash
cd frontend
npm run build
```
