var User = function (studyId, email) {
    this.studyId = studyId;
    this.email = email;

};

User.prototype.setWeight = function (weight) {
    this.weight = weight;
};

User.prototype.setAge = function (age) {
    this.age = age;
};

User.prototype.setHeight = function (height) {
    this.height = height;
};

User.prototype.setGender = function (gender) {
    this.gender = gender;
};

User.prototype.setReason = function (reason) {
    this.reason = reason;
};

User.prototype.setUserId = function (id) {
    this.userId = id;
};

module.exports = User;