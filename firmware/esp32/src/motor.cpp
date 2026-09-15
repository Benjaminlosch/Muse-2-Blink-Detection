#include "motor.h"

#include <Arduino.h>

#include "config.h"

namespace bcihand {

#if defined(MOTOR_MODE_DC_HBRIDGE)

void Motor::begin() {
  pinMode(pins::kDirPin, OUTPUT);
  pinMode(pins::kCloseButtonPin, INPUT_PULLUP);
  pinMode(pins::kOpenButtonPin, INPUT_PULLUP);
  ledcSetup(motor::kPwmChannel, motor::kPwmFrequencyHz, motor::kPwmResolutionBits);
  ledcAttachPin(pins::kPwmPin, motor::kPwmChannel);
  ledcWrite(motor::kPwmChannel, 0);  // never drive on boot — HOLD is inert
  digitalWrite(pins::kDirPin, LOW);
}

void Motor::applyCommand(Command command) {
  if (command == last_applied_) return;  // idempotent; avoid re-toggling DIR under load unnecessarily
  last_applied_ = command;

  switch (command) {
    case Command::kOpen:
      digitalWrite(pins::kDirPin, HIGH);
      ledcWrite(motor::kPwmChannel, motor::kDriveDutyCycle);
      break;
    case Command::kClose:
      digitalWrite(pins::kDirPin, LOW);
      ledcWrite(motor::kPwmChannel, motor::kDriveDutyCycle);
      break;
    case Command::kHold:
    default:
      ledcWrite(motor::kPwmChannel, 0);  // no PWM duty -> no torque, regardless of DIR
      break;
  }
}

#elif defined(MOTOR_MODE_SERVO)

namespace {
int angleToDutyCounts(int angle_deg) {
  int pulse_us = map(angle_deg, 0, 180, motor::kServoMinPulseUs, motor::kServoMaxPulseUs);
  int period_us = 1000000 / motor::kServoPwmFrequencyHz;
  long max_duty = (1L << motor::kServoPwmResolutionBits) - 1;
  return static_cast<int>((static_cast<long>(pulse_us) * max_duty) / period_us);
}
}  // namespace

void Motor::begin() {
  ledcSetup(motor::kServoPwmChannel, motor::kServoPwmFrequencyHz, motor::kServoPwmResolutionBits);
  ledcAttachPin(pins::kServoPin, motor::kServoPwmChannel);
  // Start at the HOLD angle, not OPEN or CLOSE — never move on boot.
  ledcWrite(motor::kServoPwmChannel, angleToDutyCounts(motor::kServoHoldAngleDeg));
}

void Motor::applyCommand(Command command) {
  if (command == last_applied_) return;
  last_applied_ = command;

  int angle;
  switch (command) {
    case Command::kOpen:
      angle = motor::kServoOpenAngleDeg;
      break;
    case Command::kClose:
      angle = motor::kServoCloseAngleDeg;
      break;
    case Command::kHold:
    default:
      angle = motor::kServoHoldAngleDeg;
      break;
  }
  ledcWrite(motor::kServoPwmChannel, angleToDutyCounts(angle));
}

#endif

}  // namespace bcihand
