# Monitoring-Test

설문이용 모니터링 &amp; 성능테스트 Repository

### k6 실행 명령어

`k6 run --out influxdb=http://localhost:8086/k6db --env BASE_URL=${api-base-url} survey_participant_test.js`
