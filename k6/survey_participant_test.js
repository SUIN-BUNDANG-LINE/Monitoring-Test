import http from "k6/http";
import { check } from "k6";
import { Trend } from "k6/metrics";
import {
  randomItem,
  uuidv4,
} from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

// 성능 측정을 위한 트렌드 메트릭 정의
const surveyRequestDuration = new Trend("survey_details_duration");
const progressRequestDuration = new Trend("survey_progress_duration");
const responseRequestDuration = new Trend("survey_response_duration");
const surveyMakeInfoDuration = new Trend("survey_make_info_duration");
const surveyResultDuration = new Trend("survey_result_duration");
const surveyParticipantListDuration = new Trend(
  "survey_participant_list_duration"
);

export const options = {
  scenarios: {
    // 비 피크 시간대
    off_peak_load: {
      executor: "constant-arrival-rate",
      rate: 10,
      duration: "5m",
      timeUnit: "1m",
      preAllocatedVUs: 2,
      maxVUs: 10,
    },
    // 피크 시간대
    peak_load: {
      executor: "constant-arrival-rate",
      rate: 50,
      duration: "5m",
      timeUnit: "1m",
      startTime: "5m",
      preAllocatedVUs: 10,
      maxVUs: 40,
    },
  },
  thresholds: {
    survey_details_duration: ["avg<200"], // 설문 상세 조회 평균 응답 시간 200ms 미만
    survey_progress_duration: ["avg<200"], // 설문 진행 정보 조회 평균 응답 시간 200ms 미만
    survey_response_duration: ["avg<400"], // 설문 응답 평균 응답 시간 400ms 미만
    survey_make_info_duration: ["avg<200"], // 설문 제작 정보 조회 평균 응답 시간 200ms 미만
    survey_result_duration: ["avg<200"], // 설문 결과 조회 평균 응답 시간 200ms 미만
    survey_participant_list_duration: ["avg<200"], // 설문 참가자 목록 조회 평균 응답 시간 200ms 미만
  },
};

const baseURL = __ENV.BASE_URL || "http://localhost:8080";
const surveyListAPI = `${baseURL}/api/v1/surveys/list?size=5000`;

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
            );
            while (choices.size < numChoices) {
              choices.add(randomItem(question.choices));
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
      if (responses.length > 0) {
        return {
          questionId: question.questionId,
          responses: responses,
        };
      }
      return null;
    })
    .filter((response) => response !== null);
}

// 무작위 질문을 선택하고 필터를 추가하는 함수
function generateQuestionFilters(responseBody) {
  let questionFilters = [];

  // 응답에서 sectionResults를 확인하고 질문을 선택
  if (responseBody.sectionResults && responseBody.sectionResults.length > 0) {
    let section = randomItem(responseBody.sectionResults);

    // 질문 모으기
    let questions = section.questionResults.map((question) => question);

    if (questions.length > 0) {
      // 질문이 1개면 그 질문을 선택하고, 2개 이상이면 1~2개 선택 (중복 방지)
      let numQuestionsToSelect = Math.min(
        Math.floor(Math.random() * 2) + 1,
        questions.length
      );
      let selectedQuestions = [];

      // 중복되지 않도록 질문 선택
      for (let i = 0; i < numQuestionsToSelect; i++) {
        let randomIndex = Math.floor(Math.random() * questions.length);
        let selectedQuestion = questions.splice(randomIndex, 1)[0]; // 선택된 질문을 배열에서 제거
        selectedQuestions.push(selectedQuestion);
      }

      selectedQuestions.forEach((question) => {
        if (question.responses.length > 0) {
          let content = randomItem(question.responses).content;
          // 70% 확률로 isPositive가 true, 30% 확률로 false
          let isPositive = Math.random() < 0.7;
          questionFilters.push({
            questionId: question.questionId,
            contents: [content],
            isPositive: isPositive,
          });
        }
      });
    }
  }

  return questionFilters;
}

export function setup() {
  // 설문 목록 가져오기
  let res = http.get(surveyListAPI);
  let surveyIds = [];
  if (res.status === 200) {
    try {
      let data = res.json();
      if (data && data.surveys) {
        surveyIds = data.surveys.map((survey) => survey.surveyId);
      }
    } catch (e) {
      console.error("설문 목록 JSON 파싱 실패");
    }
  } else {
    console.error("설문 목록 가져오기 실패");
  }
  return { surveyIds: surveyIds };
}

export default function (data) {
  let surveyIds = data.surveyIds;

  // 무작위로 설문 ID 선택
  let surveyId = randomItem(surveyIds);

  const surveyDetailsAPI = `${baseURL}/api/v1/surveys/info/${surveyId}`;
  const surveyProgressAPI = `${baseURL}/api/v1/surveys/progress/${surveyId}`;
  const surveyResponseAPI = `${baseURL}/api/v1/surveys/response/fake/${surveyId}`;

  // 1. 설문 상세 정보 조회
  let res = http.get(surveyDetailsAPI);
  const surveyDetails = res.json();
  surveyRequestDuration.add(res.timings.duration);
  check(res, { "설문 상세 정보 조회 성공": (r) => r.status === 200 });

  // 2. 설문 진행 정보 조회
  res = http.get(surveyProgressAPI);
  progressRequestDuration.add(res.timings.duration);
  const progressSuccess = check(res, {
    "설문 진행 정보 조회 성공": (r) => r.status === 200,
  });
  let progressData = {};
  if (progressSuccess) {
    try {
      progressData = res.json();
    } catch (e) {
      console.error("진행 정보 JSON 파싱 실패");
    }
  }

  // 3. 무작위 응답 생성
  let sectionResponses = [];
  if (progressSuccess && progressData.sections) {
    sectionResponses = progressData.sections.map((section) => {
      return {
        sectionId: section.sectionId,
        questionResponses: generateRandomResponse(section),
      };
    });
  }

  const visitorId = uuidv4();

  const surveyResponsePayload = JSON.stringify({
    sectionResponses: sectionResponses,
    visitorId,
  });

  const headers = { "Content-Type": "application/json" };

  // 4. 설문 응답 전송
  res = http.post(surveyResponseAPI, surveyResponsePayload, {
    headers: headers,
  });
  responseRequestDuration.add(res.timings.duration);
  check(res, { "설문 응답 성공": (r) => r.status === 200 });

  // 해당 설문이 통계를 공개하지 않았다면 시나리오 종료
  if (!surveyDetails.isResultOpen) return;

  // 5. 두 번째 설문 상세 정보 조회
  res = http.get(surveyDetailsAPI);
  surveyRequestDuration.add(res.timings.duration);
  check(res, { "설문 상세 정보 조회 성공": (r) => r.status === 200 });

  const surveyMakeInfoAPI = `${baseURL}/api/v1/surveys/make-info/${surveyId}`;
  const surveyResultAPI = `${baseURL}/api/v1/surveys/management/result/${surveyId}?visitorId=${visitorId}`;
  const surveyParticipantListAPI = `${baseURL}/api/v1/surveys/management/participants/${surveyId}?visitorId=${visitorId}`;

  // 6. 설문 제작 정보 조회
  res = http.get(surveyMakeInfoAPI);
  surveyMakeInfoDuration.add(res.timings.duration);
  check(res, { "설문 제작 정보 조회 성공": (r) => r.status === 200 });

  // 7. 설문 결과 조회
  const emptyFilters = JSON.stringify({
    questionFilters: [],
  });
  res = http.post(surveyResultAPI, emptyFilters, { headers: headers });
  const surveyResult = res.json();
  surveyResultDuration.add(res.timings.duration);
  check(res, { "설문 결과 조회 성공": (r) => r.status === 200 });

  // 8. 필터 바꿔가며 설문 결과 조회 2회 반복
  for (let i = 0; i < 2; i++) {
    const filters = JSON.stringify({
      questionFilters: generateQuestionFilters(surveyResult),
    });
    res = http.post(surveyResultAPI, filters, { headers: headers });
    surveyResultDuration.add(res.timings.duration);
    check(res, { "설문 결과 조회 성공": (r) => r.status === 200 });
  }

  // 9. 참가자 목록 조회
  res = http.get(surveyParticipantListAPI);
  surveyParticipantListDuration.add(res.timings.duration);
  check(res, { "참가자 목록 조회 성공": (r) => r.status === 200 });

  // 10. 참가자 목록 조회 및 설문 결과 조회(개별 응답 보기)
  res = http.get(surveyParticipantListAPI);
  const participantIds = res
    .json()
    .participants.map((participant) => participant.participantId);
  surveyParticipantListDuration.add(res.timings.duration);
  check(res, { "참가자 목록 조회 성공": (r) => r.status === 200 });

  res = http.post(
    surveyResultAPI + `&participantId=${randomItem(participantIds)}`,
    emptyFilters,
    { headers: headers }
  );
  surveyResultDuration.add(res.timings.duration);
  check(res, { "설문 결과 조회 성공": (r) => r.status === 200 });
}
