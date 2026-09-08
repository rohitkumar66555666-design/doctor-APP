from pydantic import BaseModel, Field
from typing import Optional, List


class PatientDetails(BaseModel):
    name: str = Field(default="", description="Patient's full name")
    age: Optional[int] = Field(default=None, description="Patient's age")
    gender: str = Field(default="", description="Patient's gender")


class MedicalSummary(BaseModel):
    patient_details: PatientDetails = Field(
        default_factory=PatientDetails,
        description="Patient demographic information",
    )
    clinical_summary: str = Field(
        default="", description="Brief clinical summary of the encounter"
    )
    chief_complaint: List[str] = Field(
        default_factory=list,
        description="Primary reason(s) for the visit",
    )
    symptoms: dict = Field(
        default_factory=lambda: {"positive": [], "negative": []},
        description="Positive symptoms and stated negatives",
    )
    history_of_present_illness: str = Field(
        default="",
        description="Detailed history of the present illness",
    )
    past_medical_history: List[str] = Field(
        default_factory=list,
        description="Previous medical conditions and surgeries",
    )
    medication_history: dict = Field(
        default_factory=lambda: {"medications": [], "allergies": []},
        description="Current medications and known allergies",
    )
    clinical_observations: List[str] = Field(
        default_factory=list,
        description="Clinical observations and examination findings",
    )
    assessment: str = Field(
        default="",
        description="Provisional diagnosis / clinical impression",
    )
    plan: dict = Field(
        default_factory=lambda: {
            "investigations": [],
            "prescriptions": [],
            "follow_up": "",
        },
        description="Management plan including investigations, prescriptions, and follow-up",
    )


class TranscriptRequest(BaseModel):
    transcript: str


class TranscriptResponse(BaseModel):
    transcript: str
