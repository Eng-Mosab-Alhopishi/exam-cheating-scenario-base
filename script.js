class FaceTracker {
    constructor(videoElement, canvasElement, alertBox) {
        this.videoElement = videoElement;
        this.canvasElement = canvasElement;
        this.canvasCtx = canvasElement.getContext("2d");
        this.alertBox = alertBox;

        this.faceMesh = new FaceMesh({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });

        this.faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.9,
            minTrackingConfidence: 0.9
        });

        this.faceMesh.onResults((results) => this.onResults(results));

        this.initializeModules();
        this.startCamera();
    }

    initializeModules() {
        this.headTracker = new HeadTracker(this);
        this.mouthTracker = new MouthTracker(this);
        this.presenceTracker = new PresenceTracker(this);
    }

    async startCamera() {
        this.camera = new Camera(this.videoElement, {
            onFrame: async () => {
                await this.faceMesh.send({ image: this.videoElement });
            },
            width: 640,
            height: 480
        });
        await this.camera.start();
    }

    onResults(results) {
        this.canvasCtx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);

        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            this.presenceTracker.checkPresence(results.multiFaceLandmarks);
            this.headTracker.trackHead(results.multiFaceLandmarks);
            this.mouthTracker.trackMouth(results.multiFaceLandmarks);

            // رسم النقاط على الوجه
            for (const landmarks of results.multiFaceLandmarks) {
                this.drawFaceLandmarks(landmarks);
            }
        } else {
            // Handle case when no face is detected
            this.presenceTracker.checkPresence([]);
            this.updateStats({
                headLeft: this.headTracker.counters.left,
                headRight: this.headTracker.counters.right,
                headUp: this.headTracker.counters.up,
                headDown: this.headTracker.counters.down,
                mouthOpen: this.mouthTracker.mouthOpenCounter,
                facePresence: "غير موجود"
            });
        }
    }

    drawFaceLandmarks(landmarks) {
        this.canvasCtx.fillStyle = "blue";
        for (const landmark of landmarks) {
            this.canvasCtx.beginPath();
            this.canvasCtx.arc(
                landmark.x * this.canvasElement.width,
                landmark.y * this.canvasElement.height,
                2, 0, 2 * Math.PI
            );
            this.canvasCtx.fill();
        }
    }

    showAlert(message, duration = 3000) {
        this.alertBox.textContent = message;
        this.alertBox.style.display = "block";
        setTimeout(() => {
            this.alertBox.style.display = "none";
        }, duration);
    }

    updateStats(stats) {
        document.getElementById("head-turn-left-count").textContent = `عدد مرات التفت يسارًا: ${stats.headLeft}`;
        document.getElementById("head-turn-right-count").textContent = `عدد مرات التفت يمينًا: ${stats.headRight}`;
        document.getElementById("head-tilt-up-count").textContent = `عدد مرات الميل للأعلى: ${stats.headUp}`;
        document.getElementById("head-tilt-down-count").textContent = `عدد مرات الميل للأسفل: ${stats.headDown}`;
        document.getElementById("mouth-open-count").textContent = `عدد مرات فتح الفم: ${stats.mouthOpen}`;
        document.getElementById("face-presence-count").textContent = `حالة الوجه: ${stats.facePresence}`;
    }
}

class HeadTracker {
    constructor(faceTracker) {
        this.faceTracker = faceTracker;
        this.counters = { left: 0, right: 0, up: 0, down: 0 };
        this.previousHeadState = 'stable';
        this.lastHeadMovementTime = Date.now();

        this.yawFilter = new KalmanFilter();
        this.pitchFilter = new KalmanFilter();
    }

    trackHead(faceLandmarks) {
        const noseTip = faceLandmarks[0][1];      // طرف الأنف
        const leftEye = faceLandmarks[0][33];    // العين اليسرى
        const rightEye = faceLandmarks[0][263];  // العين اليمنى
        const leftCheek = faceLandmarks[0][234]; // الخد الأيسر
        const rightCheek = faceLandmarks[0][454]; // الخد الأيمن
        const forehead = faceLandmarks[0][10];   // الجبهة
        const chin = faceLandmarks[0][152];      // الذقن

        // حساب زاوية الالتفات (Yaw)
        const eyeCenterX = (leftEye.x + rightEye.x) / 2;
        const faceWidth = Math.abs(leftEye.x - rightEye.x);
        const turnRatio = (noseTip.x - eyeCenterX) / faceWidth;
        const yaw = this.yawFilter.update(turnRatio);

        // حساب الميل الرأسي (Pitch)
        const verticalDistance = this.calculateDistance(forehead, chin);
        const nosePosition = (noseTip.y - forehead.y) / verticalDistance;
        const pitch = this.pitchFilter.update(nosePosition);

        // تحديد حالة الرأس الحالية
        const currentHeadState = this.determineHeadState(yaw, pitch);

        // تسجيل الحركة إذا كانت تتجاوز العتبة
        if (currentHeadState !== this.previousHeadState && Date.now() - this.lastHeadMovementTime > 2000) {
            this.handleHeadMovement(currentHeadState);
            this.previousHeadState = currentHeadState;
            this.lastHeadMovementTime = Date.now();
        }

        // تحديث الإحصائيات
        this.faceTracker.updateStats({
            headLeft: this.counters.left,
            headRight: this.counters.right,
            headUp: this.counters.up,
            headDown: this.counters.down,
            mouthOpen: this.faceTracker.mouthTracker.mouthOpenCounter,
            facePresence: faceLandmarks.length > 0 ? "موجود" : "غير موجود"
        });
    }

    determineHeadState(yaw, pitch) {
        const yawThreshold = 0.2;  // عتبة الالتفات (يمين/يسار)
        const upThreshold = -0.4;  // عتبة الميل لأعلى
        const downThreshold = 0.7; // عتبة الميل لأسفل (زيادة الحساسية)

        if (yaw > yawThreshold) return 'right';
        if (yaw < -yawThreshold) return 'left';
        if (pitch < upThreshold) return 'up';
        if (pitch > downThreshold) return 'down';
        return 'stable';
    }

    handleHeadMovement(state) {
        this.counters[state]++;
        switch(state) {
            case 'right':
                this.faceTracker.showAlert("⚠️ يلتفت لليمين، هل ينظر إلى زميله؟");
                break;
            case 'left':
                this.faceTracker.showAlert("⚠️ يلتفت لليسار، هل يحاول الغش؟");
                break;
            case 'down':
                this.faceTracker.showAlert("⚠️ الرأس مائل للأسفل بشكل مريب!");
                break;
            case 'up':
                this.faceTracker.showAlert("⚠️ الرأس مائل للأعلى!");
        }
    }

    calculateDistance(point1, point2) {
        return Math.sqrt((point1.x - point2.x) ** 2 + (point1.y - point2.y) ** 2);
    }
}

class MouthTracker {
    constructor(faceTracker) {
        this.faceTracker = faceTracker;
        this.mouthOpenCounter = 0;
        this.lastMouthOpenTime = Date.now();
    }

    trackMouth(faceLandmarks) {
        const upperLip = faceLandmarks[0][13];
        const lowerLip = faceLandmarks[0][14];
        const mouthHeight = Math.abs(upperLip.y - lowerLip.y);

        if (mouthHeight > 0.03 && Date.now() - this.lastMouthOpenTime > 3000) {
            this.mouthOpenCounter++;
            this.lastMouthOpenTime = Date.now();
            this.faceTracker.showAlert("⚠️ الفم مفتوح بشكل غير طبيعي!");
        }
    }
}

class PresenceTracker {
    constructor(faceTracker) {
        this.faceTracker = faceTracker;
        this.faceLostTime = null;
    }

    checkPresence(faceLandmarks) {
        if (faceLandmarks.length === 0) {
            if (this.faceLostTime === null) this.faceLostTime = Date.now();
            if (Date.now() - this.faceLostTime > 2000) {
                this.faceTracker.showAlert("🚨 الوجه غير موجود!");
            }
        } else {
            this.faceLostTime = null;
        }
    }
}

class KalmanFilter {
    constructor() {
        this.Q = 0.01; // ضوضاء العملية
        this.R = 0.1;  // ضوضاء القياس
        this.P = 1;
        this.X = 0;
    }

    update(measurement) {
        // Prediction
        this.P += this.Q;

        // Update
        const K = this.P / (this.P + this.R);
        this.X += K * (measurement - this.X);
        this.P *= (1 - K);

        return this.X;
    }
}

// بدء التتبع
const videoElement = document.getElementById("video");
const canvasElement = document.getElementById("canvas");
const alertBox = document.getElementById("alert-box");

const faceTracker = new FaceTracker(videoElement, canvasElement, alertBox);