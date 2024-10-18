import http from "k6/http";
import { sleep, check } from "k6";
import { Counter, Trend } from "k6/metrics";
import {
  randomItem,
  uuidv4,
} from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

// 각 API 별로 응답 시간을 추적할 Trend 메트릭 생성
const surveyRequestDuration = new Trend("survey_details_duration");
const progressRequestDuration = new Trend("survey_progress_duration");
const responseRequestDuration = new Trend("survey_response_duration");

// k6 옵션 설정
export const options = {
  stages: [
    { duration: "2m", target: 200 },
    { duration: "1m", target: 400 },
    { duration: "1m", target: 400 },
    { duration: "1m", target: 0 },
  ],
};

// 커맨드라인 인자로부터 surveyId와 baseURL을 받거나 기본값 설정
const surveyId = __ENV.SURVEY_ID;
const baseURL = __ENV.BASE_URL || "http://localhost:8080";

const surveyDetailsAPI = `${baseURL}/api/v1/surveys/info/${surveyId}`;
const surveyProgressAPI = `${baseURL}/api/v1/surveys/progress/${surveyId}`;
const surveyResponseAPI = `${baseURL}/api/v1/surveys/response/fake/${surveyId}`;

// 무작위 응답 생성 함수
function generateRandomResponse(section) {
  return section.questions
    .map((question) => {
      let responses = [];
      if (question.isRequired || Math.random() < 0.7) {
        // 70% 확률로 응답 생성
        switch (question.type) {
          case "SINGLE_CHOICE":
            let choice = randomItem(question.choices);
            responses.push({ content: choice, isOther: false });
            break;
          case "MULTIPLE_CHOICE":
            let choices = new Set();
            const numChoices = Math.min(
              Math.floor(Math.random() * question.choices.length) + 1,
              question.choices.length
            ); // 선택할 개수를 조정
            while (choices.size < numChoices) {
              choices.add(randomItem(question.choices)); // 중복 제거
            }
            Array.from(choices).forEach((choice) => {
              responses.push({ content: choice, isOther: false });
            });
            break;
          case "TEXT_RESPONSE":
            responses.push({ content: "주관식 응답입니다.", isOther: false });
            break;
        }
      }
      // responses가 비어있으면 null 반환하여 해당 질문을 응답에서 제외
      if (responses.length > 0) {
        return {
          questionId: question.questionId,
          responses: responses,
        };
      }
      return null;
    })
    .filter((response) => response !== null); // 비어 있는 응답 제거
}

export default function () {
  let scenarioSuccess = true; // 시나리오 성공 여부 초기화

  // 1. 설문 상세 정보 조회
  let res = http.get(surveyDetailsAPI);
  surveyRequestDuration.add(res.timings.duration); // 응답 시간 기록
  const surveySuccess = check(res, {
    "설문 상세 정보 조회 성공": (r) => r.status === 200,
  });
  if (!surveySuccess) scenarioSuccess = false;

  // 0.5초 대기
  sleep(0.5);

  // 2. 설문 진행 정보 조회
  res = http.get(surveyProgressAPI);
  progressRequestDuration.add(res.timings.duration); // 응답 시간 기록
  const progressSuccess = check(res, {
    "설문 진행 정보 조회 성공": (r) => r.status === 200,
  });
  let progressData = {};
  if (progressSuccess) {
    try {
      progressData = res.json();
    } catch (e) {
      console.error("Failed to parse progress response JSON");
      scenarioSuccess = false;
    }
  } else {
    scenarioSuccess = false;
  }

  // 10초 대기
  sleep(10);

  // 3. 무작위 응답 생성
  let sectionResponses = [];
  if (progressSuccess && progressData.sections) {
    sectionResponses = progressData.sections.map((section) => {
      return {
        sectionId: section.sectionId,
        questionResponses: generateRandomResponse(section),
      };
    });
  } else {
    scenarioSuccess = false;
  }

  const payload = JSON.stringify({
    sectionResponses: sectionResponses,
    visitorId: uuidv4(), // 고유한 UUID 생성
  });

  const headers = { "Content-Type": "application/json" };

  // 4. 설문 응답 전송
  res = http.post(surveyResponseAPI, payload, { headers: headers });
  responseRequestDuration.add(res.timings.duration); // 응답 시간 기록
  const responseSuccess = check(res, {
    "설문 응답 성공": (r) => r.status === 200,
  });
  if (!responseSuccess) scenarioSuccess = false;

  // 최종 시나리오 성공 또는 실패 카운트
  if (scenarioSuccess) {
    scenarioSuccessCount.add(1);
  } else {
    scenarioFailureCount.add(1);
  }

  // 0.5초 대기
  sleep(0.5);
}
