package auth

import "testing"

func TestPasswordHash(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	valid, err := VerifyPassword(hash, "correct horse battery staple")
	if err != nil || !valid {
		t.Fatalf("VerifyPassword() = %v, %v", valid, err)
	}
	valid, err = VerifyPassword(hash, "wrong password")
	if err != nil || valid {
		t.Fatalf("wrong password = %v, %v", valid, err)
	}
	if _, err := VerifyPassword("not-a-password-hash", "anything"); err == nil {
		t.Fatal("malformed hash was accepted")
	}
}
