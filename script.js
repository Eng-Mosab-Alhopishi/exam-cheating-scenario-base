async function startFaceTracking() {
    const videoElement = document.getElementById("video");
    const canvasElement = document.getElementById("canvas");
    const canvasCtx = canvasElement.getContext("2d");
    const alertBox = document.getElementById("alert-box");

    // إعداد FaceMesh
    const faceMesh = new FaceMesh({
        locateFile: (file) => `libs/mediapipe/${file}`
    });

    faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.9,  // دقة أعلى
        minTrackingConfidence: 0.9
    });

    let lastBlinkTime = Date.now();
    let lastMouthOpenTime = Date.now();
    let blinkCounter = 0;
    let mouthOpenCounter = 0;
    let headTurnLeftCounter = 0;   // عداد التفت يسارا
    let headTurnRightCounter = 0;  // عداد التفت يمينا
    let headTiltUpCounter = 0;     // عداد ميل الرأس للأعلى
    let headTiltDownCounter = 0;   // عداد ميل الرأس للأسفل

    // حالة الرأس السابقة
    let previousHeadState = 'stable';  // يمكن أن تكون 'left', 'right', 'up', 'down', أو 'stable'
    let lastHeadMovementTime = Date.now();  // لتجنب تسجيل التفات متكرر

    // تنبيهات مؤقتة لتجنب التنبيهات المتكررة
    let isAlertShown = false;
    let alertTimeout;

    // مؤقت لتحديد ما إذا كان الوجه قد اختفى بالفعل
    let faceLostTime = null;
    const FACE_LOST_THRESHOLD = 2000;  // 2 ثانية قبل أن نعتبر أن الوجه غير موجود

    faceMesh.onResults(results => {
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

        // التحقق من وجود الوجه باستخدام نقاط أساسية
        if (!isFaceVisible(results.multiFaceLandmarks)) {
            if (faceLostTime === null) {
                faceLostTime = Date.now();  // بدء المؤقت عند فقدان الوجه
            }

            // إذا مر أكثر من FACE_LOST_THRESHOLD منذ فقدان الوجه
            if (Date.now() - faceLostTime > FACE_LOST_THRESHOLD) {
                showAlert("🚨 الطالب غير موجود أمام الكاميرا!");
                return;
            }
        } else {
            faceLostTime = null;  // إعادة ضبط المؤقت إذا تم اكتشاف الوجه مرة أخرى
        }

        const faceLandmarks = results.multiFaceLandmarks[0];

        // التحقق من أن faceLandmarks ليست فارغة قبل الوصول إلى النقاط
        if (!faceLandmarks) {
            return;
        }

        // 👀 **تحليل العين**
        const leftEyeUpper = faceLandmarks[159];  // الجفن العلوي
        const leftEyeLower = faceLandmarks[145];  // الجفن السفلي
        const rightEyeUpper = faceLandmarks[386];
        const rightEyeLower = faceLandmarks[374];
        const leftEyeHeight = Math.abs(leftEyeUpper.y - leftEyeLower.y);
        const rightEyeHeight = Math.abs(rightEyeUpper.y - rightEyeLower.y);
        const eyeThreshold = 0.015;  // **تم ضبطه ليكون أكثر دقة**

        if (leftEyeHeight < eyeThreshold && rightEyeHeight < eyeThreshold) {
            const now = Date.now();
            if (now - lastBlinkTime > 1000) {  // إذا مر أكثر من ثانية منذ آخر غمزة
                blinkCounter++;
                lastBlinkTime = now;
                showTemporaryAlert("⚠️ الطالب يغمض عينيه لفترة طويلة! هل هو نائم؟ 💤", 3000);
            }
        }

        // 👄 **تحليل الفم**
        const upperLip = faceLandmarks[13];  // الشفة العلوية
        const lowerLip = faceLandmarks[14];  // الشفة السفلية
        const mouthHeight = Math.abs(upperLip.y - lowerLip.y);
        const mouthThreshold = 0.03;  // **تم ضبطه ليكون أكثر دقة**

        if (mouthHeight > mouthThreshold) {
            const now = Date.now();
            if (now - lastMouthOpenTime > 3000) {  // **فتح الفم لأكثر من 3 ثوانٍ**
                mouthOpenCounter++;
                lastMouthOpenTime = now;
                showTemporaryAlert("⚠️ الطالب يتحدث أثناء الامتحان! هل هو يغش؟ 📢", 3000);
            }
        }

        // 🔄 **تحليل التفات الرأس باستخدام تقارب النقاط**
        const noseTip = faceLandmarks[1];      // طرف الأنف
        const leftCheek = faceLandmarks[234];  // الخد الأيسر
        const rightCheek = faceLandmarks[454]; // الخد الأيمن
        const forehead = faceLandmarks[10];    // نقطة على الجبهة
        const chin = faceLandmarks[152];       // الذقن

        // حساب المسافات بين الأنف والجهتين اليمنى واليسرى
        const distanceToRightCheek = calculateDistance(noseTip, rightCheek);
        const distanceToLeftCheek = calculateDistance(noseTip, leftCheek);

        // حساب المسافات بين الأنف والجزء العلوي والسفلي
        const distanceToForehead = calculateDistance(noseTip, forehead);
        const distanceToChin = calculateDistance(noseTip, chin);

        // تحديد حالة الرأس الحالية بناءً على المسافات
        let currentHeadState = 'stable';

        const horizontalThreshold = 0.05;  // **عتبة المسافة الأفقية**
        const verticalThreshold = 0.05;   // **عتبة المسافة العمودية**

        if (distanceToRightCheek < distanceToLeftCheek - horizontalThreshold) {
            currentHeadState = 'right';
        } else if (distanceToLeftCheek < distanceToRightCheek - horizontalThreshold) {
            currentHeadState = 'left';
        } else if (distanceToForehead < distanceToChin - verticalThreshold) {
            currentHeadState = 'up';
        } else if (distanceToChin < distanceToForehead - verticalThreshold) {
            currentHeadState = 'down';
        }

        // إذا تغيرت حالة الرأس، نسجل التفت جديد
        const now = Date.now();
        if (currentHeadState !== previousHeadState && now - lastHeadMovementTime > 2000) {  // 2 ثانية بين كل تفت
            switch (currentHeadState) {
                case 'left':
                    headTurnLeftCounter++;
                    showTemporaryAlert(`⚠️ الطالب يلفت رأسه يسارًا!`, 3000);
                    break;
                case 'right':
                    headTurnRightCounter++;
                    showTemporaryAlert(`⚠️ الطالب يلفت رأسه يمينًا!`, 3000);
                    break;
                case 'up':
                    headTiltUpCounter++;
                    showTemporaryAlert(`⚠️ الطالب يميل رأسه للأعلى!`, 3000);
                    break;
                case 'down':
                    headTiltDownCounter++;
                    showTemporaryAlert(`⚠️ الطالب يميل رأسه للأسفل!`, 3000);
                    break;
            }

            // تحديث حالة الرأس ووقت آخر تفت
            previousHeadState = currentHeadState;
            lastHeadMovementTime = now;
        }

        // **🔵 رسم النقاط على الوجه**
        drawFaceLandmarks(faceLandmarks, canvasCtx);

        // تحديث الإحصائيات
        updateStats(blinkCounter, mouthOpenCounter, headTurnLeftCounter, headTurnRightCounter, headTiltUpCounter, headTiltDownCounter);
    });

    // دالة للتحقق من وجود الوجه باستخدام نقاط أساسية
    function isFaceVisible(multiFaceLandmarks) {
        if (!multiFaceLandmarks || multiFaceLandmarks.length === 0) {
            return false;
        }

        const faceLandmarks = multiFaceLandmarks[0];

        // قائمة بالنقاط الأساسية التي يجب التحقق منها
        const essentialPoints = [1, 10, 152, 13, 14, 159, 145, 386, 374, 234, 454];

        // التحقق من وجود النقاط الأساسية
        for (const index of essentialPoints) {
            const point = faceLandmarks[index];
            if (!point || isNaN(point.x) || isNaN(point.y)) {
                return false;
            }
        }

        return true;
    }

    // دالة لحساب المسافة بين نقطتين
    function calculateDistance(point1, point2) {
        const dx = point2.x - point1.x;
        const dy = point2.y - point1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // دالة لعرض التنبيهات المؤقتة
    function showTemporaryAlert(message, duration) {
        if (!isAlertShown) {
            isAlertShown = true;
            showAlert(message);
            alertTimeout = setTimeout(() => {
                hideAlert();
                isAlertShown = false;
            }, duration);
        }
    }

    function showAlert(message) {
        alertBox.textContent = message;
        alertBox.style.display = "block";
    }

    function hideAlert() {
        alertBox.style.display = "none";
    }

    // دالة لرسم النقاط على الوجه
    function drawFaceLandmarks(faceLandmarks, ctx) {
        ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);

        // رسم نقاط العين باللون الأخضر
        drawPoints([159, 145, 386, 374], faceLandmarks, ctx, "green");

        // رسم نقاط الفم باللون الأحمر
        drawPoints([13, 14], faceLandmarks, ctx, "red");

        // رسم نقاط الأنف والخدين باللون الأصفر
        drawPoints([1, 234, 454], faceLandmarks, ctx, "yellow");

        // رسم نقاط الجبهة والذقن باللون البرتقالي
        drawPoints([10, 152], faceLandmarks, ctx, "orange");

        // رسم باقي النقاط باللون الأزرق
        for (const landmark of faceLandmarks) {
            ctx.beginPath();
            ctx.arc(landmark.x * canvasElement.width, landmark.y * canvasElement.height, 2, 0, 2 * Math.PI);
            ctx.fillStyle = "blue";
            ctx.fill();
        }
    }

    // دالة لرسم نقاط معينة بلون محدد
    function drawPoints(indices, landmarks, ctx, color) {
        indices.forEach(index => {
            const landmark = landmarks[index];
            if (landmark) {  // التحقق من أن النقطة موجودة
                ctx.beginPath();
                ctx.arc(landmark.x * canvasElement.width, landmark.y * canvasElement.height, 3, 0, 2 * Math.PI);
                ctx.fillStyle = color;
                ctx.fill();
            }
        });
    }

    // دالة لتحديث الإحصائيات
    function updateStats(blinkCount, mouthOpenCount, headTurnLeftCount, headTurnRightCount, headTiltUpCount, headTiltDownCount) {
        document.getElementById("blink-count").textContent = `عدد الغمزات: ${blinkCount}`;
        document.getElementById("mouth-open-count").textContent = `عدد مرات فتح الفم: ${mouthOpenCount}`;
        document.getElementById("head-turn-left-count").textContent = `عدد مرات التفت يسارًا: ${headTurnLeftCount}`;
        document.getElementById("head-turn-right-count").textContent = `عدد مرات التفت يمينًا: ${headTurnRightCount}`;
        document.getElementById("head-tilt-up-count").textContent = `عدد مرات ميل الرأس للأعلى: ${headTiltUpCount}`;
        document.getElementById("head-tilt-down-count").textContent = `عدد مرات ميل الرأس للأسفل: ${headTiltDownCount}`;
    }

    // بدء الكاميرا
    const camera = new Camera(videoElement, {
        onFrame: async () => {
            await faceMesh.send({ image: videoElement });
        },
        width: 640,
        height: 480
    });
    camera.start();
}

startFaceTracking().catch(error => console.error("🚨 خطأ في تتبع الوجه:", error));